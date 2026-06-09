/**
 * LexisLocal Dashboard Application Controller
 * Handles tabs navigation, status checking, Ollama model manager, RAG inbox, and Agent Chat.
 */

document.addEventListener('DOMContentLoaded', () => {
    const app = new LexisLocalApp();
    app.init();
    window.appInstance = app;
});

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
         .toString()
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

class LexisLocalApp {
    constructor() {
        // Dynamically adjust API base to current location host (Tailscale / remote IP / VPN)
        const origin = window.location.origin;
        this.apiBase = origin.startsWith('file://') || origin.includes('null') ? 'http://localhost:4000/api' : `${origin}/api`;
        this.activeTab = 'overview';
        this.models = [];
        this.inbox = [];
        this.watcherActive = true;
        this.apiToken = localStorage.getItem('lexis_api_token') || '';
        
        // Calendar state
        this.calendarState = {
            currentYear: new Date().getFullYear(),
            currentMonth: new Date().getMonth(),
            selectedDate: new Date().toISOString().split('T')[0],
            events: []
        };
        this.expandedTimelines = new Set();
        this.emailSettings = null;
        this.emailTasks = [];
    }

    getHeaders(extraHeaders = {}) {
        const headers = { ...extraHeaders };
        if (this.apiToken) {
            headers['X-API-Token'] = this.apiToken;
        }
        return headers;
    }

    async init() {
        this.bindEvents();
        this.startClock();
        
        // Load API token input value if present
        const tokenInput = document.getElementById('api-token-input');
        if (tokenInput && this.apiToken) {
            tokenInput.value = this.apiToken;
        }
        
        // Initial data load
        await this.checkSystemStatus();
        await this.checkRagStatus();
        await this.loadModels();
        await this.loadEmailSettings();
        await this.loadEmailTasks();
        await this.loadInbox();
        await this.loadAlerts();
        await this.loadAgentsList();
        
        // Periodically refresh stats and inbox
        setInterval(() => this.checkSystemStatus(), 10000);
        setInterval(() => this.checkRagStatus(), 10000);
        setInterval(() => {
            const activeFilterBtn = document.querySelector('.filter-btn.active');
            const filter = activeFilterBtn ? activeFilterBtn.getAttribute('data-filter') : 'all';
            if (filter === 'emails') {
                this.loadEmailTasks().then(() => this.renderInbox());
            } else {
                this.loadInbox();
            }
        }, 8000);
        setInterval(() => this.loadAlerts(), 10000);
    }

    bindEvents() {
        // Tab Navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.getAttribute('data-tab');
                this.switchTab(tab);
            });
        });

        // Test File Mock Generator Button
        const parseTestBtn = document.getElementById('btn-parse-test');
        if (parseTestBtn) {
            parseTestBtn.addEventListener('click', () => this.generateTestSpis());
        }

        // Upload File trigger
        const uploadBtn = document.getElementById('btn-upload-file');
        const fileUploader = document.getElementById('file-uploader');
        if (uploadBtn && fileUploader) {
            uploadBtn.addEventListener('click', () => fileUploader.click());
            fileUploader.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    this.handleFileSelected(file);
                }
            });
        }

        // Registry Search Action
        const regSearchBtn = document.getElementById('btn-registry-search');
        if (regSearchBtn) {
            regSearchBtn.addEventListener('click', () => this.performRegistrySearch());
        }
        
        // Registry input Enter key
        const regInput = document.getElementById('registry-search-input');
        if (regInput) {
            regInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.performRegistrySearch();
                }
            });
        }

        // Pull Model Action
        const pullModelBtn = document.getElementById('btn-btn-pull-model') || document.getElementById('btn-pull-model');
        if (pullModelBtn) {
            pullModelBtn.addEventListener('click', () => this.pullOllamaModel());
        }

        // Chat send trigger
        const chatSendBtn = document.getElementById('btn-chat-send');
        if (chatSendBtn) {
            chatSendBtn.addEventListener('click', () => this.sendChatMessage());
        }
        const chatTextarea = document.getElementById('chat-textarea');
        if (chatTextarea) {
            chatTextarea.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendChatMessage();
                }
            });
            chatTextarea.addEventListener('input', () => {
                chatTextarea.style.height = 'auto';
                chatTextarea.style.height = chatTextarea.scrollHeight + 'px';
            });
        }

        // Swarm Debate Toggle UI behavior
        const swarmToggle = document.getElementById('toggle-swarm-debate');
        if (swarmToggle) {
            swarmToggle.addEventListener('change', (e) => {
                const agent2Container = document.getElementById('config-agent-2-container');
                const lblAgent1 = document.getElementById('lbl-agent-1');
                
                if (e.target.checked) {
                    if (agent2Container) agent2Container.style.display = 'block';
                    if (lblAgent1) lblAgent1.textContent = 'Aktivní AI Asistent / Tvůrce:';
                } else {
                    if (agent2Container) agent2Container.style.display = 'none';
                    if (lblAgent1) lblAgent1.textContent = 'Aktivní AI Asistent:';
                }
            });
        }

        // Auto-select recommended model when active assistant changes
        const chatAgentSelect = document.getElementById('chat-agent-select');
        if (chatAgentSelect) {
            chatAgentSelect.addEventListener('change', (e) => {
                const agentId = e.target.value;
                const agent = this.agents.find(a => a.id === agentId);
                if (agent && agent.preferredModel) {
                    const modelSelect = document.getElementById('chat-model-select');
                    if (modelSelect) {
                        modelSelect.value = agent.preferredModel;
                        console.log(`🤖 Auto-selected recommended model [${agent.preferredModel}] for assistant [${agent.name}]`);
                    }
                }
            });
        }

        // Semantic Search triggers
        const searchBtn = document.getElementById('btn-semantic-search');
        if (searchBtn) {
            searchBtn.addEventListener('click', () => this.performSemanticSearch());
        }
        const searchInput = document.getElementById('semantic-search-input');
        if (searchInput) {
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    this.performSemanticSearch();
                }
            });
        }
        const reindexBtn = document.getElementById('btn-reindex-all');
        if (reindexBtn) {
            reindexBtn.addEventListener('click', () => this.reindexAllRag());
        }

        // Save API Token Action
        const saveTokenBtn = document.getElementById('btn-save-token');
        if (saveTokenBtn) {
            saveTokenBtn.addEventListener('click', () => {
                const tokenInput = document.getElementById('api-token-input');
                if (tokenInput) {
                    const token = tokenInput.value.trim();
                    this.apiToken = token;
                    localStorage.setItem('lexis_api_token', token);
                    
                    const statusText = document.getElementById('token-status-text');
                    if (statusText) {
                        statusText.textContent = token ? "✓ Bezpečnostní klíč byl bezpečně uložen v prohlížeči." : "✓ Bezpečnostní klíč byl smazán.";
                        statusText.style.display = 'block';
                        setTimeout(() => {
                            statusText.style.display = 'none';
                        }, 4000);
                    }
                    
                    // Reload data with new credentials
                    this.checkSystemStatus();
                    this.loadModels();
                    this.loadInbox();
                }
            });
        }

        // Refresh Audit Log Action
        const refreshAuditBtn = document.getElementById('btn-refresh-audit');
        if (refreshAuditBtn) {
            refreshAuditBtn.addEventListener('click', () => this.loadAuditLogs());
        }

        // Clear Audit Log Action
        const clearAuditBtn = document.getElementById('btn-clear-audit');
        if (clearAuditBtn) {
            clearAuditBtn.addEventListener('click', () => {
                if (confirm("Opravdu chcete vymazat celou historii auditních logů? Všechny provozní statistiky budou vynulovány.")) {
                    this.clearAuditLogs();
                }
            });
        }

        // Search Audit Log Input
        const auditSearchInput = document.getElementById('audit-search-input');
        if (auditSearchInput) {
            auditSearchInput.addEventListener('input', () => this.filterAuditLogs());
        }

        // --- AI Agents Customizer Listeners ---
        const btnAddAgent = document.getElementById('btn-add-agent');
        if (btnAddAgent) {
            btnAddAgent.addEventListener('click', () => this.showNewAgentForm());
        }

        const agentEditorForm = document.getElementById('agent-editor-form');
        if (agentEditorForm) {
            agentEditorForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.submitAgentForm();
            });
        }

        const btnResetAgent = document.getElementById('btn-reset-agent');
        if (btnResetAgent) {
            btnResetAgent.addEventListener('click', () => {
                const agentId = document.getElementById('agent-form-id').value;
                if (confirm("Opravdu chcete tohoto systémového agenta vrátit do výchozího stavu? Vaše úpravy promptu budou smazány.")) {
                    this.resetAgent(agentId);
                }
            });
        }

        const btnDeleteAgent = document.getElementById('btn-delete-agent');
        if (btnDeleteAgent) {
            btnDeleteAgent.addEventListener('click', () => {
                const agentId = document.getElementById('agent-form-id').value;
                if (confirm("Opravdu chcete tohoto vlastního agenta trvale smazat?")) {
                    this.deleteAgent(agentId);
                }
            });
        }

        // Global Keyboard Shortcuts
        window.addEventListener('keydown', (e) => {
            // Alt+T (or Option+T on macOS)
            if (e.altKey && (e.code === 'KeyT' || e.key.toLowerCase() === 't')) {
                e.preventDefault();
                const dialog = document.getElementById('dialog-quick-timelog');
                if (dialog) {
                    if (dialog.open) {
                        dialog.close();
                    } else {
                        this.openQuickTimeLogModal();
                    }
                }
            }
        });
    }

    startClock() {
        const timeEl = document.getElementById('system-time');
        const updateClock = () => {
            const now = new Date();
            if (timeEl) {
                timeEl.textContent = now.toLocaleTimeString('cs-CZ');
            }
        };
        updateClock();
        setInterval(updateClock, 1000);
    }

    switchTab(tabName) {
        this.activeTab = tabName;
        
        // Update sidebar state
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
        });

        // Update tab pane state
        document.querySelectorAll('.tab-pane').forEach(pane => {
            pane.classList.toggle('active', pane.getAttribute('id') === `tab-${tabName}`);
        });

        // Update titles
        const pageTitle = document.getElementById('page-title');
        const pageSubtitle = document.getElementById('page-subtitle');

        const headers = {
            overview: {
                title: "Řídicí panel",
                sub: "Rychlý přehled lokálního AI ekosystému a stavu služeb."
            },
            inbox: {
                title: "Doručená pošta spisy",
                sub: "Seznam naskenovaných a zindexovaných spisů ze složky LexisSpisy."
            },
            models: {
                title: "Správce AI modelů",
                sub: "Stahování a správa lokálních neuronových sítí z knihovny Ollama."
            },
            chat: {
                title: "Konzultace s AI",
                sub: "Konzultujte právní případy s jedním nebo více lokálními AI asistenty."
            },
            manual: {
                title: "Nápověda & Nastavení",
                sub: "Kompletní návod na konfiguraci lokální AI a chování asistentů."
            },
            agents: {
                title: "Správce AI asistentů",
                sub: "Vizuální konfigurátor chování a systémových instrukcí lokálních asistentů."
            },
            workflow: {
                title: "Workflow & Automatizace Lhůt",
                sub: "Hlídání procesních lhůt z příchozích zpráv a automatické recepty."
            },
            timetracking: {
                title: "Time-tracking & Výkazy práce",
                sub: "Automatické klientské timesheety a sledování aktivity v reálném čase."
            },
            risks: {
                title: "Hlídač rizik & Legislativa",
                sub: "Detektor střetu zájmů klienta a kontrola souladu doložek s judikaturou Nejvyššího soudu."
            },
            managerial: {
                title: "Manažerská inteligence & Přehledy",
                sub: "Ekonomické řízení ziskovosti spisů, rozpočty a přehled kapacitního vytížení týmu."
            },
            audit: {
                title: "Auditní logy & Provoz",
                sub: "Historie zpracování dat, OCR úkonů a klientského vytížení AI."
            }
        };

        if (pageTitle && pageSubtitle && headers[tabName]) {
            pageTitle.textContent = headers[tabName].title;
            pageSubtitle.textContent = headers[tabName].sub;
        }

        // Action triggers on tab switch
        if (tabName === 'models') {
            this.loadModels();
        } else if (tabName === 'inbox') {
            this.loadInbox();
        } else if (tabName === 'audit') {
            this.loadAuditLogs();
        } else if (tabName === 'agents') {
            this.loadAgentsList();
        } else if (tabName === 'workflow') {
            this.loadWorkflowTab();
        } else if (tabName === 'timetracking') {
            this.loadTimeTrackingTab();
        } else if (tabName === 'risks') {
            this.loadRisksTab();
        } else if (tabName === 'managerial') {
            this.loadManagerialTab();
        }

        // Auto close mobile drawer on tab switch
        this.toggleMobileSidebar(false);
    }

    toggleMobileSidebar(open) {
        const sidebar = document.querySelector('.sidebar');
        const backdrop = document.getElementById('sidebar-backdrop');
        if (sidebar) {
            sidebar.classList.toggle('open', open);
        }
        if (backdrop) {
            backdrop.classList.toggle('active', open);
        }
    }

    async checkSystemStatus() {
        try {
            const res = await fetch(`${this.apiBase}/status`, {
                headers: this.getHeaders()
            });
            const data = await res.json();
            
            // Set paths and counts
            const pathEl = document.getElementById('watch-dir-path');
            if (pathEl && data.watcherDir) {
                pathEl.textContent = data.watcherDir;
            }
            
            // Load Swarm info on Overview
            if (data.activeAgents) {
                this.renderOverviewAgents(data.activeAgents);
            }
        } catch (e) {
            console.warn("Chyba při komunikaci se serverem status:", e);
        }
    }

    renderOverviewAgents(agentIds) {
        const listEl = document.getElementById('agents-list');
        if (!listEl) return;
        
        // Rich definitions matching backend server configuration
        const definitions = {
            resersnik: {
                name: "Robot „Rešeršník“",
                emoji: "📚",
                role: "Právní analýzy",
                desc: "Specializovaný koncipient provádějící rešerše nad českou legislativou a vyhledávající relevantní judikáty Nejvyššího soudu ČR."
            },
            stylista: {
                name: "Robot „Stylista“",
                emoji: "✍️",
                role: "Style Cloning",
                desc: "Dokonale klonuje advokátův osobitý tón a styl psaní. Přepisuje text do elegantní a autoritativní advokátní češtiny."
            },
            kontrolor: {
                name: "Robot „Kontrolor“",
                emoji: "⚖️",
                role: "Audit a rizika",
                desc: "Působí jako protihráč a oponent. Vyhledává logické trhliny ve smlouvách, neurčitosti a slabá místa v právní argumentaci."
            },
            sekretarka: {
                name: "Robot „Sekretářka“",
                emoji: "⏰",
                role: "Kancelářská agenda",
                desc: "Spravuje a organizuje lhůty k vyjádření, sestavuje úkoly ze spisů, připravuje doložky a formátuje odpovědi pro klienty."
            },
            spisovatel: {
                name: "Robot „Spisovatel“",
                emoji: "📝",
                role: "Draftování dokumentů",
                desc: "Sestavuje žaloby, smlouvy, odvolání a další právní dokumenty na základě Vašeho zadání a citlivě zapracovává Vaše připomínky."
            }
        };

        let html = '';
        agentIds.forEach(id => {
            const def = definitions[id] || { name: id, emoji: "🤖", role: "AI Asistent", desc: "Aktivní agent swarmu." };
            html += `
                <div class="agent-card glass">
                    <div class="agent-card-header">
                        <div class="agent-avatar">${def.emoji}</div>
                        <div class="agent-info">
                            <h4>${def.name}</h4>
                            <span>${def.role}</span>
                        </div>
                    </div>
                    <p>${def.desc}</p>
                </div>
            `;
        });
        
        listEl.innerHTML = html;
    }

    async loadInbox() {
        try {
            const res = await fetch(`${this.apiBase}/inbox/all`, {
                headers: this.getHeaders()
            });
            const data = await res.json();
            this.inbox = data.inbox || [];
            
            // Set unread badge in sidebar
            const unreadCount = this.inbox.filter(f => f.status === 'unread').length;
            const badgeEl = document.getElementById('inbox-badge');
            if (badgeEl) {
                if (unreadCount > 0) {
                    badgeEl.textContent = unreadCount;
                    badgeEl.style.display = 'inline-block';
                } else {
                    badgeEl.style.display = 'none';
                }
            }

            // Set counter text
            const countText = document.getElementById('inbox-count-text');
            if (countText) {
                countText.textContent = `Nalezeno ${this.inbox.length} dokumentů (z toho ${unreadCount} nových)`;
            }

            this.renderInbox();
        } catch (e) {
            console.error("Chyba načítání inboxu:", e);
        }
    }

    renderInbox() {
        const container = document.getElementById('inbox-container');
        if (!container) return;

        // Get filter state
        const activeFilterBtn = document.querySelector('.filter-btn.active');
        const filter = activeFilterBtn ? activeFilterBtn.getAttribute('data-filter') : 'all';

        // Filter list
        if (filter === 'emails') {
            const countText = document.getElementById('inbox-count-text');
            if (countText) {
                countText.textContent = `Nalezeno ${this.emailTasks.length} e-mailových úkolů`;
            }
            this.renderEmailTasks();
            return;
        }

        let filtered = this.inbox;
        if (filter === 'unread') {
            filtered = this.inbox.filter(f => f.status === 'unread');
        } else if (filter === 'read') {
            filtered = this.inbox.filter(f => f.status === 'read');
        }

        if (filtered.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📁</div>
                    <h3>Žádné spisy v této kategorii</h3>
                    <p>Vložte spisy do složky na Vaší ploše a LexisLocal je ihned zanalyzuje.</p>
                </div>
            `;
            return;
        }

        // Bind filter button triggers once
        document.querySelectorAll('.filter-btn').forEach(btn => {
            if (!btn.dataset.bound) {
                btn.dataset.bound = "true";
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.renderInbox();
                });
            }
        });

        // Group files by caseNumber (spisová značka)
        const groups = {};
        filtered.forEach(doc => {
            const caseNum = doc.caseNumber || "Bez sp. zn.";
            if (!groups[caseNum]) {
                groups[caseNum] = [];
            }
            groups[caseNum].push(doc);
        });

        let html = '';
        Object.keys(groups).forEach(caseNum => {
            const files = groups[caseNum];
            const caseNumSanitized = caseNum.replace(/[^a-zA-Z0-9-_]/g, '_');
            
            // Gather group-wide metadata
            const firstWithPlaintiff = files.find(f => f.plaintiff && f.plaintiff !== 'Nezjištěn');
            const groupPlaintiff = firstWithPlaintiff ? firstWithPlaintiff.plaintiff : "Nezjištěn";
            
            const firstWithDefendant = files.find(f => f.defendant && f.defendant !== 'Nezjištěn');
            const groupDefendant = firstWithDefendant ? firstWithDefendant.defendant : "Nezjištěn";
            
            const firstWithSeat = files.find(f => f.verifiedSeat);
            const groupVerifiedSeat = firstWithSeat ? firstWithSeat.verifiedSeat : null;
            
            const hasInsolvency = files.some(f => f.inInsolvency);
            const firstWithInsolCase = files.find(f => f.insolvencyCase);
            const insolvencyCase = firstWithInsolCase ? firstWithInsolCase.insolvencyCase : null;

            // Gather closest deadline
            const filesWithDeadline = files.filter(f => f.deadlineDays && f.deadlineDate);
            let closestFile = null;
            if (filesWithDeadline.length > 0) {
                closestFile = filesWithDeadline.reduce((closest, f) => {
                    return (!closest || f.deadlineDays < closest.deadlineDays) ? f : closest;
                }, null);
            }

            const insolWarning = hasInsolvency ? `
                <span class="insolvency-warning-badge" style="margin-left: 10px;">⚠️ INSOLVENCE SUBJEKTU</span>
            ` : '';

            // Group deadline html
            let deadlineHtml = '';
            if (closestFile) {
                const isCritical = closestFile.deadlineDays <= 3;
                const criticalClass = isCritical ? 'critical' : '';
                const warningEmoji = isCritical ? '🚨' : '📅';
                deadlineHtml = `
                    <div class="deadline-countdown ${criticalClass}">
                        <span>${warningEmoji} Lhůta: ${closestFile.deadlineDays} dnů</span>
                    </div>
                    <span class="subtext">Termín: ${new Date(closestFile.deadlineDate).toLocaleDateString('cs-CZ')}</span>
                    <button class="btn btn-secondary" onclick="window.appInstance.downloadIcsFile('${caseNum.replace(/'/g, "\\'")}', '${groupPlaintiff.replace(/'/g, "\\'")}', '${groupDefendant.replace(/'/g, "\\'")}', '${closestFile.deadlineDate}')" style="margin-top: 10px; width: 100%; font-size: 0.72rem; padding: 5px 8px; display: flex; align-items: center; justify-content: center; gap: 4px;">
                        📅 Do kalendáře (.ics)
                    </button>
                `;
            } else {
                deadlineHtml = `<span class="subtext text-muted">Bez lhůty</span>`;
            }

            const verifiedAddr = groupVerifiedSeat ? `
                <br><span style="font-size: 0.75rem; color: var(--accent-green);">✓ Ověřené sídlo ARES: ${groupVerifiedSeat}</span>
            ` : '';

            // Generate HTML list for each file in this case group
            let filesHtml = '';
            files.forEach(doc => {
                const isUnread = doc.status === 'unread';
                filesHtml += `
                    <div class="case-file-row" style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.015); padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border-glass);">
                        <div style="display: flex; align-items: center; gap: 10px; font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%;">
                            <span>${doc.wasOcr ? '🔍' : '📄'}</span>
                            <span style="font-weight: 500; overflow: hidden; text-overflow: ellipsis;">${doc.fileName}</span>
                            ${isUnread ? '<span style="width: 6px; height: 6px; background-color: var(--accent-red); border-radius: 50%; display: inline-block; flex-shrink: 0;"></span>' : ''}
                            ${doc.wasOcr ? '<span style="font-size: 0.65rem; background: rgba(139,92,246,0.15); color: #a78bfa; border: 1px solid rgba(139,92,246,0.25); border-radius: 4px; padding: 1px 5px; flex-shrink: 0;">OCR</span>' : ''}
                        </div>
                        <div style="display: flex; gap: 6px;">
                            <button class="btn btn-secondary" onclick="window.appInstance.viewSpisContent('${doc.fileName}')" style="padding: 4px 8px; font-size: 0.7rem;">
                                📖 Zobrazit
                            </button>
                            ${isUnread ? `
                                <button class="btn btn-secondary" onclick="window.appInstance.markRead('${doc.fileName}')" style="padding: 4px 8px; font-size: 0.7rem;">
                                    ✓ Vyřídit
                                </button>
                            ` : ''}
                            <button class="btn btn-danger" onclick="window.appInstance.deleteSpis('${doc.fileName}')" style="padding: 4px 6px; font-size: 0.7rem;">
                                🗑️
                            </button>
                        </div>
                    </div>
                `;
            });

            const isExpanded = this.expandedTimelines && this.expandedTimelines.has(caseNum);
            const timelineDisplay = isExpanded ? 'block' : 'none';
            const btnText = isExpanded ? '✕ Skrýt historii' : '⏱️ Časová osa spisu';
            const btnStyle = isExpanded 
                ? 'background: rgba(239, 68, 68, 0.08); border-color: rgba(239, 68, 68, 0.25); color: #f87171;' 
                : 'background: rgba(59, 130, 246, 0.08); border-color: rgba(59, 130, 246, 0.25); color: #60a5fa;';

            html += `
                <div class="inbox-card glass" style="display: flex; flex-direction: row; gap: 20px; padding: 25px; margin-bottom: 15px;">
                    <div class="inbox-avatar" style="font-size: 1.5rem; background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); width: 54px; height: 54px; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        📂
                    </div>
                    <div class="inbox-info" style="flex-grow: 1;">
                        <div class="inbox-info-header" style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                            <h4 style="font-size: 1.1rem; font-weight: 700; color: var(--text-primary);">Spis sp. zn.: ${caseNum}</h4>
                            ${insolWarning}
                        </div>
                        <div class="parties-text" style="font-size: 0.88rem; color: var(--text-secondary); margin-bottom: 12px;">
                            <strong>Žalobce:</strong> ${groupPlaintiff} | <strong>Žalovaný:</strong> ${groupDefendant}
                            ${verifiedAddr}
                        </div>
                        
                        <div class="case-files-explorer" style="margin-top: 15px; border-top: 1px solid var(--border-glass); padding-top: 15px;">
                            <h5 style="font-size: 0.82rem; font-weight: 600; margin-bottom: 8px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">📁 Obsah spisu (${files.length} dokumentů):</h5>
                            <div style="display: flex; flex-direction: column; gap: 6px;">
                                ${filesHtml}
                            </div>
                            
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px;">
                                <button class="btn btn-secondary" onclick="window.appInstance.analyzeEntireCase('${caseNum.replace(/'/g, "\\'")}')" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 0.78rem; padding: 8px 12px;">
                                    🤖 Analyzovat AI (${files.length} dok.)
                                </button>
                                <button id="btn-timeline-toggle-${caseNumSanitized}" class="btn btn-secondary" onclick="window.appInstance.showCaseTimeline('${caseNum.replace(/'/g, "\\'")}')" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 0.78rem; padding: 8px 12px; ${btnStyle}">
                                    ${btnText}
                                </button>
                            </div>

                            <!-- Inline Collapsible Timeline -->
                            <div class="case-timeline-collapse" id="timeline-collapse-${caseNumSanitized}" style="display: ${timelineDisplay}; margin-top: 15px; border-top: 1px dashed var(--border-glass); padding-top: 15px;">
                                <div class="inline-timeline-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                                    <div class="inline-timeline-title" style="font-size: 0.85rem; font-weight: 700; color: var(--accent-blue); display: flex; align-items: center; gap: 6px;">
                                        ⏱️ Historie a časová osa spisu
                                    </div>
                                    <button class="btn btn-secondary" onclick="window.appInstance.showCaseTimeline('${caseNum.replace(/'/g, "\\'")}')" style="padding: 2px 8px; font-size: 0.7rem;">✕ Zavřít</button>
                                </div>
                                <div class="timeline-events-inline-list" id="timeline-events-${caseNumSanitized}" style="display: flex; flex-direction: column; gap: 12px;">
                                    <!-- Populate via JS -->
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="inbox-deadline" style="width: 180px; display: flex; flex-direction: column; align-items: flex-end; justify-content: flex-start; text-align: right; flex-shrink: 0; border-left: 1px solid var(--border-glass); padding-left: 20px;">
                        ${deadlineHtml}
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;

        // Trigger fetch for any inline timelines that were already expanded
        if (this.expandedTimelines) {
            this.expandedTimelines.forEach(caseNum => {
                this.loadInlineTimelineData(caseNum);
            });
        }
    }

    async markRead(fileName) {
        try {
            const res = await fetch(`${this.apiBase}/inbox/mark-read`, {
                method: 'POST',
                headers: this.getHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ fileName })
            });
            const data = await res.json();
            if (data.success) {
                await this.loadInbox();
            }
        } catch (e) {
            alert("Chyba při označování za vyřízené: " + e.message);
        }
    }

    downloadIcsFile(caseNumber, plaintiff, defendant, deadlineDate) {
        try {
            const uid = 'lexis_' + Date.now() + '@lexislocal.lan';
            const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
            
            // Format YYYY-MM-DD to YYYYMMDD
            const dateStr = deadlineDate.replace(/-/g, '');
            
            const icsContent = [
                'BEGIN:VCALENDAR',
                'VERSION:2.0',
                'PRODID:-//LexisLocal AI//Legal Workstation//CS',
                'BEGIN:VEVENT',
                `UID:${uid}`,
                `DTSTAMP:${now}`,
                `DTSTART;VALUE=DATE:${dateStr}`,
                `DTEND;VALUE=DATE:${dateStr}`,
                `SUMMARY:⚖️ Lhůta sp. zn. ${caseNumber}`,
                `DESCRIPTION:Lhůta k vyjádření zjištěná systémem LexisLocal.\\n\\nSpis: ${caseNumber}\\nŽalobce: ${plaintiff}\\nŽalovaný: ${defendant}`,
                'STATUS:CONFIRMED',
                'SEQUENCE:0',
                'BEGIN:VALARM',
                'TRIGGER:-PT9H', // Notification at 9:00 AM on the day of the event
                'ACTION:DISPLAY',
                'DESCRIPTION:Reminder',
                'END:VALARM',
                'END:VEVENT',
                'END:VCALENDAR'
            ].join('\r\n');
            
            const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `lhuta_${caseNumber.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '')}.ics`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            alert(`📅 Lhůta pro spis ${caseNumber} byla úspěšně vyexportována!\n\nSoubor .ics se stáhl do Vašeho počítače. Poklepáním na něj ho ihned přidáte do svého Outlooku nebo systémového Kalendáře.`);
        } catch (e) {
            console.error("Chyba při stahování kalendáře:", e);
            alert("❌ Nepodařilo se vygenerovat kalendář: " + e.message);
        }
    }

    async deleteSpis(fileName) {
        if (!confirm(`Opravdu si přejete kompletně smazat spis „${fileName}“ ze seznamu i z disku?`)) return;
        
        try {
            const res = await fetch(`${this.apiBase}/inbox/delete`, {
                method: 'POST',
                headers: this.getHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ fileName })
            });
            const data = await res.json();
            if (data.success) {
                await this.loadInbox();
            }
        } catch (e) {
            alert("Chyba při mazání souboru: " + e.message);
        }
    }

    async viewSpisContent(fileName) {
        const doc = this.inbox.find(f => f.fileName === fileName);
        this.viewedSpisCaseNumber = doc ? doc.caseNumber : "Neznámá sp. zn.";
        this.viewedSpisName = fileName;
        this.viewedSpisContent = "";
        
        const modal = document.getElementById('spis-modal');
        const titleEl = document.getElementById('modal-spis-title');
        const textEl = document.getElementById('modal-spis-text');
        
        if (titleEl) titleEl.textContent = `📄 Načítám obsah: ${fileName}`;
        if (textEl) textEl.textContent = "Načítám obsah spisu z disku...";
        if (modal) modal.style.display = 'flex';
        
        try {
            const res = await fetch(`${this.apiBase}/inbox/content?fileName=${encodeURIComponent(fileName)}`, {
                headers: this.getHeaders()
            });
            const data = await res.json();
            if (data.error) {
                if (textEl) textEl.textContent = `❌ Chyba: ${data.error}`;
            } else {
                this.viewedSpisContent = data.content;
                if (titleEl) titleEl.textContent = `📄 Spis: ${fileName} [sp. zn. ${this.viewedSpisCaseNumber}]`;
                if (textEl) textEl.textContent = data.content || "Dokument je prázdný.";
            }
        } catch (e) {
            if (textEl) textEl.textContent = `❌ Chyba při načítání souboru: ${e.message}`;
        }
    }

    closeSpisModal() {
        const modal = document.getElementById('spis-modal');
        if (modal) modal.style.display = 'none';
        this.viewedSpisContent = "";
        this.viewedSpisName = "";
    }

    sendSpisToChat() {
        if (!this.viewedSpisContent) {
            alert("Není načten žádný platný obsah spisu k analýze.");
            return;
        }
        
        const chatTextarea = document.getElementById('chat-textarea');
        if (chatTextarea) {
            chatTextarea.value = `Zanalyzuj mi prosím spis sp. zn. ${this.viewedSpisCaseNumber} (${this.viewedSpisName}):\n\n${this.viewedSpisContent}\n\n`;
            chatTextarea.style.height = 'auto';
            chatTextarea.style.height = (chatTextarea.scrollHeight + 10) + 'px';
            chatTextarea.focus();
            
            const agentSelect = document.getElementById('chat-agent-select');
            if (agentSelect) {
                agentSelect.value = 'resersnik';
            }
        }
        
        this.closeSpisModal();
        this.switchTab('chat');
    }

    async sendSpisToLexisEditor() {
        if (!this.viewedSpisContent) {
            alert("Není načten žádný platný obsah spisu k odeslání.");
            return;
        }
        await this.sendTextToLexisEditor(this.viewedSpisContent, `Spis ${this.viewedSpisName}`);
    }

    async sendTextToLexisEditor(text, title = "Import z LexisLocal") {
        try {
            console.log("🔌 Odesílám text do LexisEditoru na portu 3300...");
            
            // Format HTML content to be loaded in the Quill Editor elegantly
            const formattedHtml = `<h3>📝 ${title}</h3>
<p><i>Importováno z Vaší sémantické paměti LexisLocal dne ${new Date().toLocaleString('cs-CZ')}:</i></p>
<hr>
<pre>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;

            const res = await fetch("http://localhost:3300/api/import", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    text: formattedHtml,
                    title: title,
                    source: "LexisLocal Integration Hub"
                })
            });
            
            const data = await res.json();
            if (data.success) {
                alert(`✓ Text byl okamžitě přenesen a importován do rozepsaného dokumentu v LexisEditoru!`);
            } else {
                alert("❌ Nepodařilo se importovat text do LexisEditoru: " + (data.error || "Neznámá chyba"));
            }
        } catch (err) {
            console.warn("⚠️ Připojení k LexisEditoru selhalo:", err);
            alert("⚠️ Nepodařilo se spojit s LexisEditorem na portu 3300.\n\nUjistěte se prosím, že je program LexisEditor spuštěný, a zkuste to znovu!");
        }
    }

    async analyzeEntireCase(caseNum) {
        const groupFiles = this.inbox.filter(f => f.caseNumber === caseNum);
        if (groupFiles.length === 0) {
            alert("Ve spisu nebyly nalezeny žádné dokumenty.");
            return;
        }

        const chatTextarea = document.getElementById('chat-textarea');
        if (chatTextarea) {
            chatTextarea.value = `Probíhá načítání a spojování spisových podkladů...`;
            chatTextarea.focus();
        }

        this.switchTab('chat');

        let combinedContent = "";
        
        try {
            for (const file of groupFiles) {
                const res = await fetch(`${this.apiBase}/inbox/content?fileName=${encodeURIComponent(file.fileName)}`, {
                    headers: this.getHeaders()
                });
                const data = await res.json();
                if (!data.error && data.content) {
                    combinedContent += `--- SOUBOR: ${file.fileName} ---\n${data.content}\n\n`;
                }
            }

            if (chatTextarea) {
                chatTextarea.value = `Zanalyzuj mi prosím kompletní spisové podklady pro spis sp. zn. ${caseNum}:\n\n${combinedContent}\n\n`;
                chatTextarea.style.height = 'auto';
                chatTextarea.style.height = (chatTextarea.scrollHeight + 10) + 'px';
                chatTextarea.focus();
                
                const agentSelect = document.getElementById('chat-agent-select');
                if (agentSelect) {
                    agentSelect.value = 'resersnik';
                }
            }
        } catch (e) {
            alert("Chyba při spojování spisových podkladů: " + e.message);
        }
    }

    async generateTestSpis() {
        const btn = document.getElementById('btn-parse-test');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳ Generuji...';
        }
        
        try {
            const res = await fetch(`${this.apiBase}/inbox/parse-test`, { 
                method: 'POST',
                headers: this.getHeaders()
            });
            const data = await res.json();
            if (data.success) {
                await this.loadInbox();
                this.switchTab('inbox');
            }
        } catch (e) {
            alert("Chyba při generování testovacího souboru: " + e.message);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🧪 Generovat testovací spis';
            }
        }
    }

    async loadModels() {
        try {
            const res = await fetch(`${this.apiBase}/models`, {
                headers: this.getHeaders()
            });
            const data = await res.json();
            this.models = data.models || [];
            
            // Set counts
            const countEl = document.getElementById('models-count');
            if (countEl) {
                countEl.textContent = this.models.length;
            }

            this.renderModels();
            this.populateChatModelSelect();
        } catch (e) {
            console.error("Chyba při stahování seznamu modelů:", e);
        }
    }

    renderModels() {
        const container = document.getElementById('models-list');
        if (!container) return;

        if (this.models.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🤖</div>
                    <h3>Žádné lokální LLM modely</h3>
                    <p>Zadejte název modelu nahoře a stáhněte jej.</p>
                </div>
            `;
            return;
        }

        let html = '';
        this.models.forEach(m => {
            const sizeGb = (m.size / (1024 * 1024 * 1024)).toFixed(2);
            html += `
                <div class="model-card glass">
                    <div class="model-avatar">🧠</div>
                    <div class="model-details">
                        <h4>${m.name}</h4>
                        <span>Velikost: ${sizeGb} GB</span>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
    }

    populateChatModelSelect() {
        const select = document.getElementById('chat-model-select');
        if (!select) return;

        let html = '';
        if (this.models.length === 0) {
            html = `<option value="llama3">llama3 (Simulovaný Fallback)</option>`;
        } else {
            this.models.forEach(m => {
                html += `<option value="${m.name}">${m.name}</option>`;
            });
        }
        select.innerHTML = html;
    }

    async pullOllamaModel() {
        const input = document.getElementById('model-input');
        const pullBtn = document.getElementById('btn-pull-model');
        const progressContainer = document.getElementById('pull-progress-container');
        const progressBar = document.getElementById('pull-progress-bar');
        const progressStatus = document.getElementById('pull-progress-status');

        if (!input || !input.value.trim()) {
            alert("Prosím zadejte název modelu.");
            return;
        }

        const modelName = input.value.trim();
        pullBtn.disabled = true;
        pullBtn.textContent = 'Stahuji...';
        progressContainer.style.display = 'block';
        progressBar.style.width = '20%';
        progressStatus.textContent = `Spouštím stahování modelu ${modelName}...`;

        // Simulate pull progress animation smoothly
        let progress = 20;
        const interval = setInterval(() => {
            if (progress < 90) {
                progress += 5;
                progressBar.style.width = `${progress}%`;
                progressStatus.textContent = `Stahování modelu ${modelName}: ${progress}% staženo...`;
            }
        }, 1200);

        try {
            const res = await fetch(`${this.apiBase}/models/pull`, {
                method: 'POST',
                headers: this.getHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ model: modelName })
            });
            const data = await res.json();
            
            clearInterval(interval);
            progressBar.style.width = '100%';
            progressStatus.textContent = `Model ${modelName} byl úspěšně stažen a nainstalován.`;
            
            setTimeout(() => {
                progressContainer.style.display = 'none';
                input.value = '';
                this.loadModels();
            }, 3000);

        } catch (e) {
            clearInterval(interval);
            progressBar.style.width = '0%';
            progressStatus.textContent = `Chyba při stahování: ${e.message}`;
        } finally {
            pullBtn.disabled = false;
            pullBtn.textContent = 'Stáhnout model';
        }
    }

    async sendChatMessage() {
        const textarea = document.getElementById('chat-textarea');
        const agentSelect = document.getElementById('chat-agent-select');
        const modelSelect = document.getElementById('chat-model-select');
        const output = document.getElementById('chat-output');

        if (!textarea || !textarea.value.trim()) return;

        const userText = textarea.value.trim();
        const agentId = agentSelect.value;
        const modelName = modelSelect.value;

        // Render user bubble
        output.innerHTML += `
            <div class="chat-message user">
                <div class="message-avatar">👤</div>
                <div class="message-content">
                    <p>${escapeHtml(userText)}</p>
                </div>
            </div>
        `;
        textarea.value = '';
        output.scrollTop = output.scrollHeight;

        // Render typing bubble
        const typingId = `typing-${Date.now()}`;
        output.innerHTML += `
            <div class="chat-message agent" id="${typingId}">
                <div class="message-avatar">🤖</div>
                <div class="message-content">
                    <p><em>Píšu odpověď...</em></p>
                </div>
            </div>
        `;
        output.scrollTop = output.scrollHeight;

        const swarmToggle = document.getElementById('toggle-swarm-debate');
        const isSwarm = swarmToggle && swarmToggle.checked;
        
        if (isSwarm) {
            const agent2Select = document.getElementById('chat-agent-2-select');
            const agentId2 = agent2Select ? agent2Select.value : 'kontrolor';
            
            try {
                const res = await fetch(`${this.apiBase}/agent-swarm/debate`, {
                    method: 'POST',
                    headers: this.getHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify({
                        prompt: userText,
                        agentId1: agentId,
                        agentId2: agentId2,
                        model: modelName
                    })
                });
                const data = await res.json();
                
                // Remove typing indicator
                const typingEl = document.getElementById(typingId);
                if (typingEl) typingEl.remove();

                const emojis = { resersnik: "📚", stylista: "✍️", kontrolor: "⚖️", sekretarka: "⏰", spisovatel: "📝" };
                const emoji1 = emojis[agentId] || "🤖";
                const emoji2 = emojis[agentId2] || "⚖️";

                const formatted1 = data.agent1.response
                    .replace(/\n/g, '<br>')
                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                    
                const formatted2 = data.agent2.response
                    .replace(/\n/g, '<br>')
                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

                output.innerHTML += `
                    <div class="chat-message agent" style="border-left: 3px solid var(--accent-blue); padding-left: 15px; margin-bottom: 20px; background: rgba(0, 102, 204, 0.02); border-radius: 4px 12px 12px 4px; width: 100%;">
                        <div style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px; color: var(--accent-blue); font-weight: bold; margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
                            <span>👥</span> Spuštěna oponentní diskuse asistentů (Model: ${data.model})
                        </div>
                        
                        <!-- Agent 1 Bubble -->
                        <div style="display: flex; gap: 12px; margin-bottom: 15px;">
                            <div class="message-avatar" style="background: rgba(255,255,255,0.05); min-width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.1rem;">
                                ${emoji1}
                            </div>
                            <div class="message-content" style="flex: 1;">
                                <span style="font-weight: bold; color: white; font-size: 0.85rem; display: block; margin-bottom: 4px;">
                                    Prvotní vypracování (${data.agent1.name}):
                                </span>
                                <p style="margin: 0; font-size: 0.9rem; line-height: 1.5; color: var(--text-muted);">${formatted1}</p>
                            </div>
                        </div>

                        <hr style="border: none; border-top: 1px dashed var(--border-glass); margin: 15px 0;">

                        <!-- Agent 2 Bubble -->
                        <div style="display: flex; gap: 12px;">
                            <div class="message-avatar" style="background: rgba(239, 68, 68, 0.1); min-width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; border: 1px solid rgba(239, 68, 68, 0.2);">
                                ${emoji2}
                            </div>
                            <div class="message-content" style="flex: 1;">
                                <span style="font-weight: bold; color: #fca5a5; font-size: 0.85rem; display: block; margin-bottom: 4px;">
                                    Oponentní posudek & Revize (${data.agent2.name}):
                                </span>
                                <p style="margin: 0; font-size: 0.9rem; line-height: 1.5; color: white; background: rgba(255,255,255,0.02); padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border-glass);">${formatted2}</p>
                            </div>
                        </div>
                        
                        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 15px;">
                            <button class="btn btn-secondary" onclick="window.appInstance.sendTextToLexisEditor('=== NÁVRH OD ${data.agent1.name} ===\\n${data.agent1.response.replace(/'/g, "\\'").replace(/\n/g, '\\n')}\\n\\n=== REVIZE A OPONENTURA OD ${data.agent2.name} ===\\n${data.agent2.response.replace(/'/g, "\\'").replace(/\n/g, '\\n')}', 'Oponentní diskuse: ${data.agent1.name} & ${data.agent2.name}')" style="font-size: 0.75rem; padding: 5px 10px;">
                                ✍️ Odeslat diskusi do Editoru
                            </button>
                        </div>
                    </div>
                `;
                output.scrollTop = output.scrollHeight;
                
            } catch (e) {
                const typingEl = document.getElementById(typingId);
                if (typingEl) typingEl.remove();
                output.innerHTML += `<div class="chat-message agent"><div class="message-content"><p style="color:var(--accent-red);">❌ Chyba připojení: ${escapeHtml(e.message)}</p></div></div>`;
                output.scrollTop = output.scrollHeight;
            }
            return;
        }

        try {
            const res = await fetch(`${this.apiBase}/agent/${agentId}`, {
                method: 'POST',
                headers: this.getHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                    prompt: userText,
                    model: modelName
                })
            });
            const data = await res.json();
            
            // Remove typing indicator
            const typingEl = document.getElementById(typingId);
            if (typingEl) typingEl.remove();

            // Format response content dynamically
            const formatted = data.response
                .replace(/\n/g, '<br>')
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

            const emojis = { resersnik: "📚", stylista: "✍️", kontrolor: "⚖️", sekretarka: "⏰", spisovatel: "📝" };
            const emoji = emojis[agentId] || "🤖";

            output.innerHTML += `
                <div class="chat-message agent">
                    <div class="message-avatar">${emoji}</div>
                    <div class="message-content">
                        <p>${formatted}</p>
                        <span class="subtext" style="display:block; margin-top:5px; font-size:0.7rem; color:var(--text-muted);">
                            Model: ${data.model} | ${new Date(data.timestamp).toLocaleTimeString('cs-CZ')}
                        </span>
                    </div>
                </div>
            `;
            output.scrollTop = output.scrollHeight;

        } catch (e) {
            const typingEl = document.getElementById(typingId);
            if (typingEl) typingEl.remove();

            output.innerHTML += `
                <div class="chat-message agent">
                    <div class="message-avatar">⚠️</div>
                    <div class="message-content">
                        <p style="color:var(--accent-red);">Chyba spojení s lokálním serverem: ${escapeHtml(e.message)}</p>
                    </div>
                </div>
            `;
            output.scrollTop = output.scrollHeight;
        }
    }

    async checkRagStatus() {
        try {
            const res = await fetch(`${this.apiBase}/rag/status`, {
                headers: this.getHeaders()
            });
            const data = await res.json();
            const badgeEl = document.getElementById('rag-status-badge');
            if (badgeEl && data.chunksCount !== undefined) {
                badgeEl.textContent = `Index: ${data.chunksCount} pasáží (${data.filesCount} spisů)`;
            }
        } catch (e) {
            console.warn("RAG: Nepodařilo se zjistit stav vektorové databáze:", e);
        }
    }

    async performSemanticSearch() {
        const inputEl = document.getElementById('semantic-search-input');
        const resultsEl = document.getElementById('semantic-search-results');
        const loaderEl = document.getElementById('semantic-search-loader');
        
        if (!inputEl || !resultsEl || !loaderEl) return;
        
        const query = inputEl.value.trim();
        if (!query) {
            alert("Zadejte prosím dotaz pro sémantické vyhledávání.");
            return;
        }
        
        // Reset and show loader
        resultsEl.style.display = 'none';
        loaderEl.style.display = 'flex';
        
        try {
            const res = await fetch(`${this.apiBase}/rag/search?query=${encodeURIComponent(query)}&limit=5`, {
                headers: this.getHeaders()
            });
            const data = await res.json();
            
            loaderEl.style.display = 'none';
            resultsEl.style.display = 'flex';
            
            if (!data.matches || data.matches.length === 0) {
                resultsEl.innerHTML = `<div class="no-results">Nepodařilo se najít žádné pasáže odpovídající Vašemu vyhledávání. Zkuste upřesnit zadání.</div>`;
                return;
            }
            
            let html = '';
            data.matches.forEach(match => {
                const isHigh = match.score >= 0.85;
                const confidenceClass = isHigh ? 'high' : '';
                const percent = Math.round(match.score * 100);
                
                html += `
                    <div class="search-result-card glass" style="border-left-color: ${isHigh ? '#60a5fa' : '#34d399'};">
                        <div class="search-result-meta">
                            <div class="search-result-file" onclick="window.appInstance.viewSpisContent('${match.fileName.replace(/'/g, "\\'")}')">
                                📁 <span>${match.fileName}</span>
                            </div>
                            <span class="match-badge ${confidenceClass}">${percent}% shoda</span>
                        </div>
                        <div class="search-result-text">
                            "${match.text}"
                        </div>
                    </div>
                `;
            });
            resultsEl.innerHTML = html;
        } catch (e) {
            loaderEl.style.display = 'none';
            resultsEl.style.display = 'flex';
            resultsEl.innerHTML = `<div class="no-results" style="color: var(--accent-red); border-color: rgba(239, 68, 68, 0.2);">❌ Chyba sémantického vyhledávání: ${escapeHtml(e.message)}</div>`;
        }
    }

    async reindexAllRag() {
        if (!confirm("Opravdu chcete kompletně přegenerovat všechny sémantické indexy spisů?\nTato operace rozseká texty a vygeneruje nové AI embeddingy.")) return;
        
        const reindexBtn = document.getElementById('btn-reindex-all');
        const badgeEl = document.getElementById('rag-status-badge');
        
        const originalText = reindexBtn ? reindexBtn.textContent : "🔄 Přegenerovat indexy";
        if (reindexBtn) {
            reindexBtn.textContent = "🔄 Indexuji...";
            reindexBtn.disabled = true;
        }
        if (badgeEl) badgeEl.textContent = "Probíhá re-indexace...";
        
        try {
            const res = await fetch(`${this.apiBase}/rag/reindex-all`, {
                method: 'POST',
                headers: this.getHeaders()
            });
            const data = await res.json();
            
            if (data.success) {
                alert(`✓ Re-indexace úspěšně dokončena!\n${data.message}`);
            } else {
                alert("❌ Chyba re-indexace: " + (data.error || "Neznámá chyba"));
            }
        } catch (e) {
            alert("❌ Selhalo spojení se serverem pro re-indexaci: " + e.message);
        } finally {
            if (reindexBtn) {
                reindexBtn.textContent = originalText;
                reindexBtn.disabled = false;
            }
            await this.checkRagStatus();
        }
    }

    async handleFileSelected(file) {
        const uploadBtn = document.getElementById('btn-upload-file');
        const originalText = uploadBtn ? uploadBtn.textContent : "📥 Nahrát spis";
        
        if (uploadBtn) {
            uploadBtn.textContent = "📥 Nahrávám...";
            uploadBtn.disabled = true;
        }
        
        const reader = new FileReader();
        reader.onload = async (e) => {
            const base64 = e.target.result;
            try {
                const res = await fetch(`${this.apiBase}/inbox/upload`, {
                    method: 'POST',
                    headers: this.getHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify({
                        fileName: file.name,
                        base64: base64
                    })
                });
                const data = await res.json();
                if (data.success) {
                    alert(`✓ Spis ${file.name} byl úspěšně nahrán a AI ho zanalyzovala!`);
                    await this.loadInbox();
                    await this.checkRagStatus();
                } else {
                    alert("❌ Chyba při nahrávání: " + (data.error || "Neznámá chyba"));
                }
            } catch (err) {
                alert("❌ Chyba spojení při nahrávání: " + err.message);
            } finally {
                if (uploadBtn) {
                    uploadBtn.textContent = originalText;
                    uploadBtn.disabled = false;
                }
                // Clear input value to allow uploading the same file again
                const fileUploader = document.getElementById('file-uploader');
                if (fileUploader) fileUploader.value = '';
            }
        };
        
        reader.onerror = () => {
            alert("❌ Nepodařilo se přečíst soubor z disku.");
            if (uploadBtn) {
                uploadBtn.textContent = originalText;
                uploadBtn.disabled = false;
            }
        };
        
        reader.readAsDataURL(file);
    }

    async performRegistrySearch() {
        const input = document.getElementById('registry-search-input');
        const loader = document.getElementById('registry-search-loader');
        const resultsPanel = document.getElementById('registry-search-results');
        const btn = document.getElementById('btn-registry-search');
        
        if (!input || !input.value.trim()) {
            alert("⚠️ Prosím zadejte IČO.");
            return;
        }
        
        const ico = input.value.trim();
        loader.style.display = 'flex';
        resultsPanel.style.display = 'none';
        btn.disabled = true;
        
        try {
            const res = await fetch(`${this.apiBase}/registries/check?ico=${encodeURIComponent(ico)}`, {
                headers: this.getHeaders()
            });
            const data = await res.json();
            
            if (data.error) {
                alert("❌ Chyba: " + data.error);
                loader.style.display = 'none';
                btn.disabled = false;
                return;
            }
            
            // Build the report text to save
            const reportText = `==================================================
⚖️ LEXISLOCAL - OFICIÁLNÍ PROVĚRKA SUBJEKTU
==================================================
Subjekt: ${data.name}
IČO: ${data.ico}
Sídlo: ${data.seat}
Provedeno dne: ${new Date(data.verifiedAt).toLocaleString('cs-CZ')}

--------------------------------------------------
1. KATASTR NEMOVITOSTÍ (Lokalita a plomby)
--------------------------------------------------
Vlastněné nemovitosti: ${data.katastr.propertiesCount > 0 ? `ANO (${data.katastr.propertiesCount} zapsaných staveb/pozemků)` : 'NE (žádný přímý zápis vlastnictví)'}
Aktivní plombování/změna práva: ${data.katastr.hasPlomba ? '⚠️ DETEKOVÁNA PLOMBA (probíhající řízení o změně práva!)' : 'Bez omezení / Bez plomby'}
Upozornění: ${data.katastr.disclaimer}

--------------------------------------------------
2. INSOLVENČNÍ REJSTŘÍK (ISIR - Ministerstvo spravedlnosti)
--------------------------------------------------
Stav: ${data.inInsolvency ? '❌ AKTIVNÍ INSOLVENCE / ÚPADEK Subjektu' : '✅ BEZ ZÁZNAMU v insolvenčním rejstříku'}
${data.inInsolvency ? `Spisová značka: ${data.insolvencyCase}
Stav řízení: ${data.insolvencyStatus}` : ''}

--------------------------------------------------
3. CENTRÁLNÍ EVIDENCE EXEKUCÍ (CEE - Exekutorská komora)
--------------------------------------------------
Stav: ${data.cee.activeExecutions > 0 ? `⚠️ DETEKOVÁNY ${data.cee.activeExecutions} AKTIVNÍ EXEKUCE` : '✅ BEZ ZÁZNAMU o aktivních exekucích'}
${data.cee.activeExecutions > 0 ? `Celková vymáhaná jistina: ${data.cee.totalAmount.toLocaleString('cs-CZ')} Kč` : ''}
Upozornění: ${data.cee.disclaimer}

--------------------------------------------------
Generováno systémem LexisLocal. 100% soukromé a šifrované.`;

            // Display results in a gorgeous responsive card layout
            resultsPanel.innerHTML = `
                <div class="stat-card glass" style="width: 100%; display: flex; flex-direction: column; gap: 20px; padding: 25px;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 15px; border-bottom: 1px solid var(--border-glass); padding-bottom: 15px;">
                        <div>
                            <span style="font-size: 0.75rem; color: var(--accent-blue); font-weight: 700; text-transform: uppercase;">Výpis z registrů (Live)</span>
                            <h2 style="margin: 5px 0 0 0; font-size: 1.5rem; color: white;">${data.name}</h2>
                            <p style="margin: 5px 0 0 0; font-size: 0.85rem; color: var(--text-muted);">IČO: ${data.ico} | Sídlo: ${data.seat}</p>
                        </div>
                        <div style="display: flex; gap: 10px;">
                            <button class="btn btn-primary" id="btn-save-registry-report">
                                📥 Uložit lustraci do spisu
                            </button>
                            <button class="btn btn-primary" id="btn-send-registry-report" style="background: var(--accent-blue);">
                                ✍️ Odeslat do LexisEditoru
                            </button>
                        </div>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 15px;">
                        <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-glass); border-radius: 12px; padding: 15px;">
                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
                                <span style="font-size: 1.2rem;">🏛️</span>
                                <h4 style="margin: 0; color: white;">ARES a Sídlo</h4>
                            </div>
                            <p style="font-size: 0.85rem; margin: 0; color: var(--text-muted);">
                                Subjekt je řádně zapsán v obchodním/živnostenském rejstříku.
                            </p>
                        </div>

                        <div style="background: ${data.inInsolvency ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.02)'}; border: 1px solid ${data.inInsolvency ? 'rgba(239,68,68,0.2)' : 'var(--border-glass)'}; border-radius: 12px; padding: 15px;">
                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
                                <span style="font-size: 1.2rem;">❌</span>
                                <h4 style="margin: 0; color: ${data.inInsolvency ? '#f87171' : 'white'};">Insolvence (ISIR)</h4>
                            </div>
                            <p style="font-size: 0.85rem; margin: 0; color: ${data.inInsolvency ? '#fca5a5' : 'var(--text-muted)'};">
                                ${data.inInsolvency ? `<b>NALEZEN ZÁZNAM!</b><br>Sp. zn.: ${data.insolvencyCase}<br>Stav: ${data.insolvencyStatus}` : 'Subjekt momentálně není v úpadku ani v insolvenčním řízení.'}
                            </p>
                        </div>

                        <div style="background: ${data.cee.activeExecutions > 0 ? 'rgba(245,158,11,0.08)' : 'rgba(255,255,255,0.02)'}; border: 1px solid ${data.cee.activeExecutions > 0 ? 'rgba(245,158,11,0.2)' : 'var(--border-glass)'}; border-radius: 12px; padding: 15px;">
                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
                                <span style="font-size: 1.2rem;">⚠️</span>
                                <h4 style="margin: 0; color: ${data.cee.activeExecutions > 0 ? '#fbbf24' : 'white'};">Exekuce (CEE)</h4>
                            </div>
                            <p style="font-size: 0.85rem; margin: 0; color: ${data.cee.activeExecutions > 0 ? '#fde047' : 'var(--text-muted)'};">
                                ${data.cee.activeExecutions > 0 ? `<b>POZOR: ${data.cee.activeExecutions} EXEKUCE!</b><br>Celková vymáhaná jistina: ${data.cee.totalAmount.toLocaleString('cs-CZ')} Kč.` : 'Subjekt nemá evidovány žádné aktivní exekuce.'}
                            </p>
                        </div>

                        <div style="background: ${data.katastr.hasPlomba ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.02)'}; border: 1px solid ${data.katastr.hasPlomba ? 'rgba(239,68,68,0.2)' : 'var(--border-glass)'}; border-radius: 12px; padding: 15px;">
                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
                                <span style="font-size: 1.2rem;">🏡</span>
                                <h4 style="margin: 0; color: ${data.katastr.hasPlomba ? '#f87171' : 'white'};">Katastr nemovitostí</h4>
                            </div>
                            <p style="font-size: 0.85rem; margin: 0; color: var(--text-muted);">
                                ${data.katastr.propertiesCount > 0 ? `Vlastnictví nemovitostí: <b>ANO</b><br>` : 'Nemovitosti: Bez přímého zápisu<br>'}
                                ${data.katastr.hasPlomba ? '⚠️ <span style="color: #f87171; font-weight: bold;">DETEKOVÁNA PLOMBA (probíhá změna práv!)</span>' : 'Plomby / Zástavní práva: Bez omezení'}
                            </p>
                        </div>
                    </div>
                </div>
            `;
            
            // Dynamic event binding to avoid inline JSON parsing errors
            document.getElementById('btn-save-registry-report').addEventListener('click', () => {
                this.saveRegistryReport({ ico: data.ico, name: data.name, reportText });
            });
            
            document.getElementById('btn-send-registry-report').addEventListener('click', () => {
                this.sendTextToLexisEditor(reportText, `Prověrka ${data.name} (${data.ico})`);
            });
            
            resultsPanel.style.display = 'flex';
        } catch (err) {
            alert("❌ Nepodařilo se dokončit lustraci: " + err.message);
        } finally {
            loader.style.display = 'none';
            btn.disabled = false;
        }
    }

    async saveRegistryReport(reportData) {
        try {
            const res = await fetch(`${this.apiBase}/registries/save-report`, {
                method: 'POST',
                headers: this.getHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(reportData)
            });
            const data = await res.json();
            
            if (data.success) {
                alert(`✓ Prověrka subjektu "${reportData.name}" byla úspěšně uložena do spisu jako soubor: \n${data.fileName}\n\nAI ji ihned začne používat jako kontext v sémantické paměti a RAG!`);
                await this.loadInbox();
                await this.checkRagStatus();
            } else {
                alert("❌ Nepodařilo se uložit prověrku: " + (data.error || "Neznámá chyba"));
            }
        } catch (err) {
            alert("❌ Chyba připojení: " + err.message);
        }
    }

    async loadAlerts() {
        try {
            const res = await fetch(`${this.apiBase}/alerts`, {
                headers: this.getHeaders()
            });
            const data = await res.json();
            this.renderAlerts(data.alerts || []);
        } catch (err) {
            console.error("⚠️ Nepodařilo se načíst aktivní upozornění:", err.message);
        }
    }

    renderAlerts(alerts) {
        const container = document.getElementById('insolvency-alerts-container');
        if (!container) return;
        
        if (alerts.length === 0) {
            container.style.display = 'none';
            container.innerHTML = '';
            return;
        }
        
        container.innerHTML = alerts.map(alert => `
            <div class="glass" style="border: 1px solid rgba(239, 68, 68, 0.25); background: rgba(239, 68, 68, 0.04); border-radius: 12px; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; gap: 15px; width: 100%; box-shadow: 0 4px 15px rgba(239, 68, 68, 0.05); margin-bottom: 20px;">
                <div style="display: flex; align-items: center; gap: 14px;">
                    <div style="width: 42px; height: 42px; border-radius: 50%; background: rgba(239, 68, 68, 0.15); display: flex; align-items: center; justify-content: center; position: relative;">
                        <span style="font-size: 1.3rem; animation: pulse 1.8s infinite;">🚨</span>
                    </div>
                    <div>
                        <h4 style="margin: 0; color: #fca5a5; font-size: 0.95rem; font-weight: 700;">
                            DETEKOVÁNA INSOLVENCE: ${alert.name} (IČO: ${alert.ico})
                        </h4>
                        <p style="margin: 4px 0 0 0; color: var(--text-muted); font-size: 0.82rem;">
                            Sledovaný subjekt vstoupil do úpadku. Spisová značka: <b style="color: white;">${alert.caseNumber}</b> | Stav: <span style="color: #fca5a5;">${alert.insolvencyStatus}</span>
                        </p>
                        <p style="margin: 2px 0 0 0; color: var(--text-muted); font-size: 0.75rem;">
                            Související spisy: ${alert.citedFiles.join(', ')}
                        </p>
                    </div>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button class="btn btn-secondary" onclick="window.appInstance.sendTextToLexisEditor('POZOR: Sledovaný subjekt ${alert.name} (IČO: ${alert.ico}) je v INSOLVENCI! Spisová značka: ${alert.caseNumber}, Stav: ${alert.insolvencyStatus}. Bezodkladně přihlaste pohledávky.', 'Insolvenční varování')" style="font-size: 0.8rem; padding: 6px 12px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.02);">
                        ✍️ Odeslat do Editoru
                    </button>
                    <button class="btn btn-primary" onclick="window.appInstance.dismissAlert('${alert.id}')" style="font-size: 0.8rem; padding: 6px 12px; background: rgba(239, 68, 68, 0.8); border: none;">
                        Skrýt ✕
                    </button>
                </div>
            </div>
        `).join('');
        
        container.style.display = 'block';
    }

    async dismissAlert(alertId) {
        try {
            const res = await fetch(`${this.apiBase}/alerts/dismiss/${alertId}`, {
                method: 'POST',
                headers: this.getHeaders()
            });
            const data = await res.json();
            if (data.success) {
                await this.loadAlerts();
            }
        } catch (err) {
            alert("❌ Nepodařilo se skrýt upozornění: " + err.message);
        }
    }

    applyPlaybook(type) {
        const toggle = document.getElementById('toggle-swarm-debate');
        const agent1 = document.getElementById('chat-agent-select');
        const agent2 = document.getElementById('chat-agent-2-select');
        const textarea = document.getElementById('chat-textarea');
        const config2 = document.getElementById('config-agent-2-container');
        
        if (!agent1 || !agent2 || !textarea) return;
        
        // Ensure Swarm Debate toggle is checked
        if (toggle) {
            toggle.checked = true;
            if (config2) config2.style.display = 'block';
        }
        
        let promptText = "";
        
        if (type === 'due-diligence') {
            agent1.value = "spisovatel";
            agent2.value = "kontrolor";
            promptText = `[Sem vložte text smlouvy nebo doložky k analýze]\n\nUdělejte detailní právní audit této smlouvy. Agent 1 (Spisovatel) navrhne optimalizované znění, Agent 2 (Kontrolor) vyhledá skrytá rizika a slabiny pro našeho klienta.`;
        } else if (type === 'litigation') {
            agent1.value = "resersnik";
            agent2.value = "kontrolor";
            promptText = `[Sem popište spor nebo vložte žalobu protistrany]\n\nNavrhněte strategii obhajoby/žalobní argumentace. Agent 1 (Rešeršník) vyhledá relevantní argumenty a judikaturu ze spisu, Agent 2 (Oponent) zpochybní naše tvrzení a ukáže, jak bude reagovat protistrana.`;
        } else if (type === 'explainer') {
            agent1.value = "sekretarka";
            agent2.value = "stylista";
            promptText = `[Sem vložte složité právní vyjádření, rozsudek nebo smlouvu]\n\nPřeveďte tento složitý text do řeči srozumitelné pro laického klienta. Agent 1 (Sekretářka) vysvětlí hlavní podstatu bez právního žargonu, Agent 2 (Stylista) z toho zformuluje přehledný e-mail s odrážkami.`;
        }
        
        textarea.value = promptText;
        textarea.style.height = 'auto';
        textarea.style.height = (textarea.scrollHeight + 10) + 'px'; // auto resize height with padding buffer
        textarea.focus();
        
        // Temporarily highlight the playbook bar buttons
        document.querySelectorAll('.playbook-btn').forEach(btn => {
            btn.style.opacity = '0.6';
        });
        const activeBtn = document.querySelector(`.playbook-btn[onclick*="${type}"]`);
        if (activeBtn) {
            activeBtn.style.opacity = '1';
            activeBtn.style.boxShadow = '0 0 10px rgba(255,255,255,0.15)';
            setTimeout(() => {
                activeBtn.style.boxShadow = 'none';
                document.querySelectorAll('.playbook-btn').forEach(btn => btn.style.opacity = '1');
            }, 1000);
        }
    }

    async runManualInsolvencyCheck() {
        const btn = document.querySelector('button[onclick*="runManualInsolvencyCheck"]');
        let originalText = "";
        if (btn) {
            originalText = btn.innerHTML;
            btn.innerHTML = '<span>🔄</span> Prověřuji spisy...';
            btn.disabled = true;
        }
        
        try {
            const res = await fetch(`${this.apiBase}/alerts/check`, {
                method: 'POST',
                headers: this.getHeaders()
            });
            const data = await res.json();
            
            if (data.success) {
                alert(`✓ Hromadná prověrka insolvencí byla dokončena!\n\nPrověřeno unikátních IČO: ${data.checkedCount}\nNalezeno nových úpadků: ${data.newAlertsCount}\n\nPokud byl nalezen nový úpadek, zobrazí se červené varování na Dashboardu.`);
                await this.loadAlerts();
                await this.loadInbox();
            } else {
                alert("❌ Chyba při hromadné kontrole: " + (data.error || "Neznámá chyba"));
            }
        } catch (err) {
            alert("❌ Chyba spojení při hromadné kontrole: " + err.message);
        } finally {
            if (btn) {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }
    }

    async loadAuditLogs() {
        try {
            const res = await fetch(`${this.apiBase}/audit/logs`, {
                headers: this.getHeaders()
            });
            const data = await res.json();
            
            if (data.success) {
                this.auditLogs = data.logs || [];
                this.renderAuditLogs(this.auditLogs);
                this.updateAuditStats(this.auditLogs);
            } else {
                console.error("❌ Nepodařilo se načíst auditní logy:", data.error);
            }
        } catch (err) {
            console.error("❌ Chyba sítě při načítání auditních logů:", err.message);
        }
    }

    updateAuditStats(logs) {
        const totalEl = document.getElementById('audit-stat-total');
        const ocrEl = document.getElementById('audit-stat-ocr');
        const aiEl = document.getElementById('audit-stat-ai');
        const durationEl = document.getElementById('audit-stat-duration');

        if (!totalEl) return;

        const totalCount = logs.length;
        const ocrCount = logs.filter(l => {
            const op = l.operation.toLowerCase();
            return op.includes('ocr') || op.includes('dokument');
        }).length;
        const aiCount = logs.filter(l => {
            const op = l.operation.toLowerCase();
            return op.includes('ai') || op.includes('swarm');
        }).length;
        
        const totalDurationMs = logs.reduce((sum, l) => {
            return sum + (l.details && l.details.durationMs ? l.details.durationMs : 0);
        }, 0);
        const totalDurationS = (totalDurationMs / 1000).toFixed(1);

        totalEl.textContent = totalCount;
        ocrEl.textContent = ocrCount;
        aiEl.textContent = aiCount;
        durationEl.textContent = `${totalDurationS}s`;
    }

    renderAuditLogs(logs) {
        const tbody = document.getElementById('audit-log-table-body');
        if (!tbody) return;

        if (logs.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align: center; padding: 30px; opacity: 0.6;">Zatím nebyly zaznamenány žádné provozní úkony.</td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = logs.map(log => {
            const date = new Date(log.timestamp);
            const formattedDate = date.toLocaleString('cs-CZ', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });

            // Premium colored badges for operations
            let badgeClass = 'badge-system';
            if (log.operation.includes('OCR')) badgeClass = 'badge-ocr';
            else if (log.operation.includes('AI') || log.operation.includes('Swarm')) badgeClass = 'badge-ai';
            else if (log.operation.includes('Dokument') || log.operation.includes('soubor') || log.operation.includes('FileWatcher')) badgeClass = 'badge-watcher';

            // Custom details parsing
            let detailsHtml = '';
            if (log.details) {
                if (log.details.durationMs !== undefined) {
                    detailsHtml += `<span style="color: #fb7185; font-weight: 500;">⚡ ${log.details.durationMs}ms</span>`;
                }
                if (log.details.charactersCount !== undefined) {
                    detailsHtml += detailsHtml ? ' | ' : '';
                    detailsHtml += `<span style="opacity:0.8;">📄 ${log.details.charactersCount} zn.</span>`;
                }
                if (log.details.model) {
                    detailsHtml += detailsHtml ? ' | ' : '';
                    detailsHtml += `<span style="color: var(--accent-blue);">🤖 ${log.details.model}</span>`;
                }
                if (log.details.successCount !== undefined) {
                    detailsHtml += detailsHtml ? ' | ' : '';
                    detailsHtml += `<span style="color: var(--accent-green);">✓ ${log.details.successCount} spisy</span>`;
                }
            }
            if (!detailsHtml) detailsHtml = '<span style="opacity: 0.5;">—</span>';

            return `
                <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.05); hover: background-color: rgba(255,255,255,0.01);">
                    <td style="padding: 12px; font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; opacity: 0.9;">${formattedDate}</td>
                    <td style="padding: 12px;"><span style="font-weight: 500; opacity: 0.8;">${log.user}</span></td>
                    <td style="padding: 12px;"><span class="audit-badge ${badgeClass}">${log.operation}</span></td>
                    <td style="padding: 12px; font-weight: 500;">${log.target}</td>
                    <td style="padding: 12px; font-size: 0.85rem;">${detailsHtml}</td>
                </tr>
            `;
        }).join('');
    }

    async clearAuditLogs() {
        try {
            const res = await fetch(`${this.apiBase}/audit/clear`, {
                method: 'POST',
                headers: this.getHeaders()
            });
            const data = await res.json();
            
            if (data.success) {
                this.auditLogs = [];
                this.renderAuditLogs([]);
                this.updateAuditStats([]);
                alert("✓ Provozní auditní logy byly kompletně vymazány.");
            } else {
                alert("❌ Chyba při mazání logů: " + data.error);
            }
        } catch (err) {
            alert("❌ Chyba sítě při mazání logů: " + err.message);
        }
    }

    filterAuditLogs() {
        const queryInput = document.getElementById('audit-search-input');
        if (!queryInput) return;

        const query = queryInput.value.toLowerCase().trim();
        if (!query) {
            this.renderAuditLogs(this.auditLogs);
            return;
        }

        const filtered = this.auditLogs.filter(log => {
            const timeStr = new Date(log.timestamp).toLocaleString('cs-CZ').toLowerCase();
            const userStr = log.user.toLowerCase();
            const opStr = log.operation.toLowerCase();
            const targetStr = log.target.toLowerCase();
            
            // Render details into string for searching
            let detailsStr = '';
            if (log.details) {
                detailsStr = JSON.stringify(log.details).toLowerCase();
            }

            return timeStr.includes(query) || 
                   userStr.includes(query) || 
                   opStr.includes(query) || 
                   targetStr.includes(query) ||
                   detailsStr.includes(query);
        });

        this.renderAuditLogs(filtered);
    }

    async loadAgentsList() {
        try {
            console.log("🤖 Načítám AI asistenty ze serveru...");
            const res = await fetch(`${this.apiBase}/agents`, {
                headers: this.getHeaders()
            });
            const data = await res.json();
            if (data.success) {
                this.agents = data.agents;
                this.renderAgentsList(this.agents);
                this.syncAgentDropdowns(this.agents);
            } else {
                console.error("⚠️ Selhalo načtení agentů:", data.error);
            }
        } catch (err) {
            console.error("❌ Síťová chyba při načítání agentů:", err.message);
        }
    }

    renderAgentsList(agents) {
        const container = document.getElementById('agents-list-container');
        if (!container) return;

        container.innerHTML = agents.map(agent => {
            const isSystemBadge = agent.isSystem ? '<span class="system-badge">Systém</span>' : '';
            const modelBadge = agent.preferredModel ? `<span class="recommendation-badge" style="margin-top: 4px;">Doporučeno: ${agent.preferredModel}</span>` : '';
            return `
                <div class="agents-list-item" data-id="${agent.id}">
                    <div class="agent-item-avatar">${agent.emoji}</div>
                    <div class="agent-item-meta" style="flex-grow: 1;">
                        <span class="agent-item-name">${agent.name}</span>
                        <span class="agent-item-role">${agent.role}</span>
                        ${modelBadge}
                    </div>
                    ${isSystemBadge}
                </div>
            `;
        }).join('');

        // Bind clicks to list items
        container.querySelectorAll('.agents-list-item').forEach(item => {
            item.addEventListener('click', () => {
                // Highlight active item
                container.querySelectorAll('.agents-list-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');

                const agentId = item.getAttribute('data-id');
                const selected = this.agents.find(a => a.id === agentId);
                if (selected) {
                    this.showAgentEditor(selected);
                }
            });
        });
    }

    syncAgentDropdowns(agents) {
        const dropdown1 = document.getElementById('chat-agent-select');
        const dropdown2 = document.getElementById('chat-agent-2-select');
        if (!dropdown1) return;

        // Remember currently selected values if any
        const val1 = dropdown1.value;
        const val2 = dropdown2 ? dropdown2.value : '';

        // Repopulate
        dropdown1.innerHTML = '';
        if (dropdown2) dropdown2.innerHTML = '';

        agents.forEach(agent => {
            const opt1 = document.createElement('option');
            opt1.value = agent.id;
            opt1.textContent = `${agent.emoji} ${agent.name}`;
            dropdown1.appendChild(opt1);

            if (dropdown2) {
                const opt2 = document.createElement('option');
                opt2.value = agent.id;
                opt2.textContent = `${agent.emoji} ${agent.name}`;
                dropdown2.appendChild(opt2);
            }
        });

        // Restore selection if they still exist, otherwise default
        if (agents.some(a => a.id === val1)) {
            dropdown1.value = val1;
        }
        if (dropdown2 && agents.some(a => a.id === val2)) {
            dropdown2.value = val2;
        } else if (dropdown2) {
            dropdown2.value = 'kontrolor'; // default fallback for second agent
        }
    }

    showAgentEditor(agent) {
        // Toggle view
        document.getElementById('agent-editor-placeholder').style.display = 'none';
        
        const form = document.getElementById('agent-editor-form');
        form.style.display = 'flex';

        // Set inputs
        document.getElementById('agent-form-is-system').value = agent.isSystem ? 'true' : 'false';
        
        const idGroup = document.getElementById('agent-form-id-group');
        const idInput = document.getElementById('agent-form-id');
        idGroup.style.display = 'block';
        idInput.value = agent.id;
        idInput.disabled = true; // cannot edit ID of existing agents

        document.getElementById('agent-form-emoji').value = agent.emoji;
        document.getElementById('agent-form-name').value = agent.name;
        document.getElementById('agent-form-role').value = agent.role;
        document.getElementById('agent-form-prompt').value = agent.systemPrompt;
        
        // Load new model and permissions fields
        document.getElementById('agent-form-model').value = agent.preferredModel || 'llama3';
        document.getElementById('agent-form-perm-files').checked = !!(agent.permissions && agent.permissions.read_files);
        document.getElementById('agent-form-perm-registries').checked = !!(agent.permissions && agent.permissions.query_registries);
        document.getElementById('agent-form-perm-desktop').checked = !!(agent.permissions && agent.permissions.write_desktop);

        // Toggle buttons based on system status
        const btnReset = document.getElementById('btn-reset-agent');
        const btnDelete = document.getElementById('btn-delete-agent');

        if (agent.isSystem) {
            if (btnReset) btnReset.style.display = 'block';
            if (btnDelete) btnDelete.style.display = 'none';
        } else {
            if (btnReset) btnReset.style.display = 'none';
            if (btnDelete) btnDelete.style.display = 'block';
        }
    }

    showNewAgentForm() {
        // Clear active highlights
        const container = document.getElementById('agents-list-container');
        if (container) {
            container.querySelectorAll('.agents-list-item').forEach(i => i.classList.remove('active'));
        }

        // Toggle view
        document.getElementById('agent-editor-placeholder').style.display = 'none';
        
        const form = document.getElementById('agent-editor-form');
        form.style.display = 'flex';
        form.reset();

        // Configure ID field for new creation
        document.getElementById('agent-form-is-system').value = 'false';
        
        const idGroup = document.getElementById('agent-form-id-group');
        const idInput = document.getElementById('agent-form-id');
        idGroup.style.display = 'block';
        idInput.value = '';
        idInput.disabled = false;
        idInput.focus();

        // Pre-fill some generic helper values
        document.getElementById('agent-form-emoji').value = '🤖';
        document.getElementById('agent-form-name').value = '';
        document.getElementById('agent-form-role').value = '';
        document.getElementById('agent-form-prompt').value = 'Jsi specializovaný český AI asistent...';
        
        // Reset models and checkboxes
        document.getElementById('agent-form-model').value = 'llama3';
        document.getElementById('agent-form-perm-files').checked = false;
        document.getElementById('agent-form-perm-registries').checked = false;
        document.getElementById('agent-form-perm-desktop').checked = false;

        // Actions
        const btnReset = document.getElementById('btn-reset-agent');
        const btnDelete = document.getElementById('btn-delete-agent');
        if (btnReset) btnReset.style.display = 'none';
        if (btnDelete) btnDelete.style.display = 'none';
    }

    async submitAgentForm() {
        const isSystem = document.getElementById('agent-form-is-system').value === 'true';
        const idInput = document.getElementById('agent-form-id');
        const agentId = idInput.value.toLowerCase().replace(/[^a-z0-9_-]/g, '_').trim();
        
        if (!agentId) {
            alert("⚠️ Identifikátor asistenta je povinné pole.");
            return;
        }

        const name = document.getElementById('agent-form-name').value.trim();
        const emoji = document.getElementById('agent-form-emoji').value.trim();
        const role = document.getElementById('agent-form-role').value.trim();
        const systemPrompt = document.getElementById('agent-form-prompt').value.trim();
        
        // Read model and permissions inputs
        const preferredModel = document.getElementById('agent-form-model').value;
        const readFiles = document.getElementById('agent-form-perm-files').checked;
        const queryRegistries = document.getElementById('agent-form-perm-registries').checked;
        const writeDesktop = document.getElementById('agent-form-perm-desktop').checked;

        try {
            // If it is a new custom agent and disabled = false, we create a new one using POST /api/agents.
            // If it is editing, we use POST /api/agents/:agentId
            const isEditing = idInput.disabled;
            const url = isEditing ? `${this.apiBase}/agents/${agentId}` : `${this.apiBase}/agents`;
            
            const payload = {
                id: agentId,
                name,
                emoji,
                role,
                systemPrompt,
                preferredModel,
                permissions: {
                    read_files: readFiles,
                    query_registries: queryRegistries,
                    write_desktop: writeDesktop
                }
            };

            console.log(`💾 Ukládám profil asistenta [${agentId}]...`);
            const res = await fetch(url, {
                method: 'POST',
                headers: this.getHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (data.success) {
                alert(`✓ Profil asistenta "${name}" byl úspěšně uložen.`);
                await this.loadAgentsList();
                
                // Highlight the updated/created agent
                setTimeout(() => {
                    const listContainer = document.getElementById('agents-list-container');
                    if (listContainer) {
                        const item = listContainer.querySelector(`[data-id="${agentId}"]`);
                        if (item) item.click();
                    }
                }, 100);
            } else {
                alert("❌ Nepodařilo se uložit agenta: " + data.error);
            }
        } catch (err) {
            alert("❌ Síťová chyba při ukládání agenta: " + err.message);
        }
    }

    async deleteAgent(agentId) {
        try {
            console.log(`🗑️ Mažu vlastního agenta [${agentId}]...`);
            const res = await fetch(`${this.apiBase}/agents/${agentId}`, {
                method: 'DELETE',
                headers: this.getHeaders()
            });
            const data = await res.json();
            if (data.success) {
                alert("✓ Vlastní agent byl úspěšně smazán.");
                
                // Reset editor pane
                document.getElementById('agent-editor-form').style.display = 'none';
                document.getElementById('agent-editor-placeholder').style.display = 'flex';
                
                await this.loadAgentsList();
            } else {
                alert("❌ Chyba při mazání agenta: " + data.error);
            }
        } catch (err) {
            alert("❌ Síťová chyba při mazání agenta: " + err.message);
        }
    }

    async resetAgent(agentId) {
        try {
            console.log(`🔄 Resetuji systémového agenta [${agentId}] do výchozího stavu...`);
            const res = await fetch(`${this.apiBase}/agents/${agentId}/reset`, {
                method: 'POST',
                headers: this.getHeaders()
            });
            const data = await res.json();
            if (data.success) {
                alert("✓ Agent byl úspěšně obnoven do výchozího nastavení.");
                await this.loadAgentsList();
                
                // Refresh form view
                const selected = this.agents.find(a => a.id === agentId);
                if (selected) {
                    this.showAgentEditor(selected);
                }
            } else {
                alert("❌ Chyba při resetu agenta: " + data.error);
            }
        } catch (err) {
            alert("❌ Síťová chyba při resetu agenta: " + err.message);
        }
    }

    // --- WORKFLOW TAB INTEGRATIONS ---

    async loadWorkflowTab() {
        try {
            console.log("📅 Načítám workflow tab...");
            
            // Fetch Rules
            const resRules = await fetch(`${this.apiBase}/workflows/rules`, { headers: this.getHeaders() });
            const dataRules = await resRules.json();
            
            // Fetch Events (from the new events endpoint)
            const resEvents = await fetch(`${this.apiBase}/calendar/events`, { headers: this.getHeaders() });
            const dataEvents = await resEvents.json();

            if (dataRules.success) {
                this.renderWorkflowRules(dataRules.rules);
            }
            if (dataEvents.success) {
                this.calendarState.events = dataEvents.events;
                this.renderCalendar();
                this.renderAgenda();
            }
        } catch (err) {
            console.error("❌ Nelze načíst workflow data:", err);
        }
    }

    renderWorkflowRules(rules) {
        const listEl = document.getElementById('workflow-rules-list');
        if (!listEl) return;

        if (rules.length === 0) {
            listEl.innerHTML = `<div style="text-align: center; opacity: 0.6; padding: 10px; font-size: 0.8rem;">Žádná pravidla.</div>`;
            return;
        }

        listEl.innerHTML = rules.map(rule => `
            <div class="glass" style="padding: 10px 12px; border-radius: 8px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-glass); display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; margin-bottom: 6px;">
                <div style="flex-grow: 1; min-width: 0; padding-right: 8px;">
                    <strong style="color: white; display: block; margin-bottom: 2px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${rule.name}</strong>
                    <span style="opacity: 0.6; font-size: 0.7rem; display: block; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
                        Trigger: <code>${rule.triggerType === 'document_saved' ? 'Uložení' : 'ISDS'}</code> | Kdy: <code>${rule.conditionValue}</code>
                    </span>
                    <span style="display: block; font-size: 0.7rem; color: var(--accent-gold); margin-top: 2px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">➡️ ${rule.actionTitle}</span>
                </div>
                <div>
                    ${rule.isSystem ? 
                        `<span style="font-size: 0.65rem; color: var(--accent-blue); padding: 1px 4px; background: rgba(59,130,246,0.1); border-radius: 4px; border: 1px solid rgba(59,130,246,0.2);">Systém</span>` :
                        `<button class="btn btn-secondary" onclick="window.appInstance.deleteWorkflowRule('${rule.id}')" style="padding: 2px 6px; font-size: 0.65rem; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2); color: #f87171;">Smazat</button>`
                    }
                </div>
            </div>
        `).join('');
    }

    renderCalendar() {
        const monthYearEl = document.getElementById('calendar-month-year');
        const daysContainer = document.getElementById('calendar-days-grid');
        if (!monthYearEl || !daysContainer) return;

        const currentYear = this.calendarState.currentYear;
        const currentMonth = this.calendarState.currentMonth;

        const monthNamesCs = [
            "Leden", "Únor", "Březen", "Duben", "Květen", "Červen", 
            "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"
        ];

        monthYearEl.textContent = `${monthNamesCs[currentMonth]} ${currentYear}`;

        // Calculate days to display
        let firstDayIndex = new Date(currentYear, currentMonth, 1).getDay();
        if (firstDayIndex === 0) firstDayIndex = 7; // Convert Sunday to 7
        
        const prevMonthDays = new Date(currentYear, currentMonth, 0).getDate();
        const currentMonthDays = new Date(currentYear, currentMonth + 1, 0).getDate();

        const days = [];

        // Prev month days padding
        const prevDaysCount = firstDayIndex - 1;
        for (let i = prevDaysCount; i > 0; i--) {
            days.push({
                day: prevMonthDays - i + 1,
                dateString: null,
                isPrevNext: true
            });
        }

        // Current month days
        for (let i = 1; i <= currentMonthDays; i++) {
            const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
            days.push({
                day: i,
                dateString: dateStr,
                isPrevNext: false
            });
        }

        // Next month days padding to make full grid of 42
        const remaining = 42 - days.length;
        for (let i = 1; i <= remaining; i++) {
            days.push({
                day: i,
                dateString: null,
                isPrevNext: true
            });
        }

        // Render days
        daysContainer.innerHTML = '';
        days.forEach(day => {
            const cell = document.createElement('div');
            cell.className = 'calendar-day';
            
            if (day.isPrevNext) {
                cell.classList.add('prev-next');
                cell.innerHTML = `<span class="day-number">${day.day}</span>`;
                daysContainer.appendChild(cell);
                return;
            }

            if (day.dateString === this.calendarState.selectedDate) {
                cell.classList.add('active');
            }

            const todayStr = new Date().toISOString().split('T')[0];
            if (day.dateString === todayStr) {
                cell.classList.add('today');
            }

            const dayEvents = this.calendarState.events.filter(e => e.date === day.dateString);
            
            let dotsHtml = '';
            if (dayEvents.length > 0) {
                dotsHtml = '<div class="calendar-day-events">';
                // Render max 3 dots, then "+" indicator
                const renderLimit = 3;
                dayEvents.slice(0, renderLimit).forEach(e => {
                    const dotClass = e.status === 'completed' ? 'completed' : e.type === 'hearing' ? 'hearing' : 'deadline';
                    dotsHtml += `<span class="calendar-day-dot ${dotClass}" title="${e.title}"></span>`;
                });
                if (dayEvents.length > renderLimit) {
                    dotsHtml += `<span style="font-size:0.6rem; line-height:1; opacity:0.6; margin-left:1px;">+</span>`;
                }
                dotsHtml += '</div>';
            }

            cell.innerHTML = `
                <span class="day-number">${day.day}</span>
                ${dotsHtml}
            `;

            cell.addEventListener('click', () => this.selectDay(day.dateString));
            daysContainer.appendChild(cell);
        });
    }

    renderAgenda() {
        const agendaEl = document.getElementById('calendar-day-agenda');
        const dateLabel = document.getElementById('calendar-selected-date-label');
        if (!agendaEl || !dateLabel) return;

        const selectedDate = this.calendarState.selectedDate;
        const parts = selectedDate.split('-');
        dateLabel.textContent = `${parseInt(parts[2])}. ${parseInt(parts[1])}. ${parts[0]}`;

        const dayEvents = this.calendarState.events.filter(e => e.date === selectedDate);

        if (dayEvents.length === 0) {
            agendaEl.innerHTML = `
                <div style="text-align: center; padding: 30px; opacity: 0.6; font-size: 0.85rem;">
                    🌴 Dnes nemáte žádné lhůty ani jednání.
                </div>
            `;
            return;
        }

        agendaEl.innerHTML = dayEvents.map(event => {
            const isCompleted = event.status === 'completed';
            const isCancelled = event.status === 'cancelled';
            const isHearing = event.type === 'hearing';

            let icon = '⏰';
            let typeLabel = 'Procesní lhůta';
            let itemClass = 'deadline';

            if (isCompleted) {
                icon = '🟢';
                itemClass = 'completed';
            } else if (isCancelled) {
                icon = '❌';
                typeLabel = 'ZRUŠENÉ JEDNÁNÍ';
                itemClass = 'completed';
            } else if (isHearing) {
                icon = '⚖️';
                typeLabel = 'Soudní jednání';
                itemClass = 'hearing';
            }

            let metaHtml = '';
            if (event.time || event.location) {
                metaHtml = `<div style="font-size: 0.75rem; opacity: 0.8; display: flex; flex-direction: column; gap: 2px; margin-top: 4px;">`;
                if (event.time) metaHtml += `<span>🕒 ${event.time}</span>`;
                if (event.location) metaHtml += `<span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${event.location}">📍 ${event.location}</span>`;
                metaHtml += `</div>`;
            }

            let actionButtons = '';
            if (!isCompleted && !isCancelled) {
                actionButtons = `<div style="display: flex; gap: 8px; margin-top: 8px;">`;
                if (event.type === 'deadline') {
                    actionButtons += `<button class="btn btn-secondary" onclick="window.appInstance.completeAlert('${event.id}')" style="padding: 4px 8px; font-size: 0.7rem; background: rgba(16,185,129,0.1); border-color: rgba(16,185,129,0.2); color: #34d399;">Splnit ✓</button>`;
                }
                actionButtons += `<button class="btn btn-secondary" onclick="window.appInstance.syncEventToSystemCalendar('${event.id}')" style="padding: 4px 8px; font-size: 0.7rem; background: rgba(59,130,246,0.1); border-color: rgba(59,130,246,0.2); color: #60a5fa;">Zapsat do kalendáře 📅</button>`;
                actionButtons += `</div>`;
            }

            return `
                <div class="calendar-event-item ${itemClass}">
                    <div style="display: flex; align-items: flex-start; gap: 10px;">
                        <span style="font-size: 1.1rem; line-height: 1;">${icon}</span>
                        <div style="flex-grow: 1; min-width: 0;">
                            <strong style="color: white; font-size: 0.85rem; display: block; text-decoration: ${isCompleted ? 'line-through' : 'none'}; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${event.title}">${event.title}</strong>
                            <span style="font-size: 0.7rem; opacity: 0.6; display: block; margin-top: 2px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${typeLabel} — ${event.description}</span>
                            ${metaHtml}
                            ${actionButtons}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    prevMonth() {
        this.calendarState.currentMonth--;
        if (this.calendarState.currentMonth < 0) {
            this.calendarState.currentMonth = 11;
            this.calendarState.currentYear--;
        }
        this.renderCalendar();
    }

    nextMonth() {
        this.calendarState.currentMonth++;
        if (this.calendarState.currentMonth > 11) {
            this.calendarState.currentMonth = 0;
            this.calendarState.currentYear++;
        }
        this.renderCalendar();
    }

    jumpToToday() {
        const today = new Date();
        this.calendarState.currentYear = today.getFullYear();
        this.calendarState.currentMonth = today.getMonth();
        this.calendarState.selectedDate = today.toISOString().split('T')[0];
        this.renderCalendar();
        this.renderAgenda();
    }

    selectDay(dateString) {
        this.calendarState.selectedDate = dateString;
        this.renderCalendar();
        this.renderAgenda();
    }

    async syncHearingsPortal() {
        try {
            console.log("⚖️ Synchronizuji jednání z portálu InfoJednání...");
            const res = await fetch(`${this.apiBase}/calendar/sync`, {
                method: 'POST',
                headers: this.getHeaders()
            });
            const data = await res.json();
            if (data.success) {
                alert(`✓ Portálová synchronizace dokončena.\nZkontrolováno: ${data.checked} jednání\nNalezeno: ${data.updated} změn`);
                await this.loadWorkflowTab();
            } else {
                alert("❌ Portálová synchronizace selhala: " + data.error);
            }
        } catch (err) {
            alert("❌ Síťová chyba při synchronizaci: " + err.message);
        }
    }

    async syncEventToSystemCalendar(eventId) {
        const event = this.calendarState.events.find(e => e.id === eventId);
        if (!event) return;

        try {
            console.log(`📅 Zapisuji událost [${event.title}] do systémového kalendáře...`);
            const res = await fetch(`${this.apiBase}/calendar/add`, {
                method: 'POST',
                headers: {
                    ...this.getHeaders(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    id: event.id,
                    title: event.title,
                    dueDate: event.date,
                    time: event.time || null,
                    location: event.location || null,
                    context: event.description,
                    isHearing: event.type === 'hearing'
                })
            });

            const data = await res.json();
            if (data.success) {
                if (data.syncStatus === 'created') {
                    alert(`✓ Událost "${event.title}" byla úspěšně zapsána do Vašeho systémového kalendáře.`);
                } else if (data.syncStatus === 'duplicate') {
                    alert(`ℹ️ Událost "${event.title}" již ve Vašem systémovém kalendáři existuje.`);
                } else if (data.syncStatus === 'unsupported_platform') {
                    alert(`⚠️ Tato platforma nepodporuje přímý zápis do kalendáře, ale ICS soubor byl uložen v adresáři Kalendář.`);
                } else {
                    alert(`✓ ICS soubor byl vygenerován.`);
                }
            } else {
                alert("❌ Chyba při zápisu do kalendáře: " + data.error);
            }
        } catch (err) {
            alert("❌ Síťová chyba zápisu: " + err.message);
        }
    }

    async saveWorkflowRule(e) {
        e.preventDefault();
        const name = document.getElementById('wf-rule-name').value;
        const triggerType = document.getElementById('wf-rule-trigger').value;
        const conditionField = document.getElementById('wf-rule-field').value;
        const conditionValue = document.getElementById('wf-rule-value').value;
        const actionTitle = document.getElementById('wf-rule-action').value;

        try {
            const res = await fetch(`${this.apiBase}/workflows/rules`, {
                method: 'POST',
                headers: {
                    ...this.getHeaders(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name, triggerType, conditionField, conditionValue, actionTitle })
            });

            const data = await res.json();
            if (data.success) {
                alert("✓ Pravidlo bylo úspěšně vytvořeno a uloženo.");
                document.getElementById('workflow-rule-form').reset();
                await this.loadWorkflowTab();
            } else {
                alert("❌ Selhalo vytvoření pravidla: " + data.error);
            }
        } catch (err) {
            alert("❌ Síťová chyba: " + err.message);
        }
    }

    async deleteWorkflowRule(id) {
        if (!confirm("Opravdu chcete smazat toto pravidlo?")) return;
        try {
            const res = await fetch(`${this.apiBase}/workflows/rules/${id}`, {
                method: 'DELETE',
                headers: this.getHeaders()
            });
            const data = await res.json();
            if (data.success) {
                await this.loadWorkflowTab();
            }
        } catch (err) {
            alert("❌ Nelze smazat pravidlo: " + err.message);
        }
    }

    async completeAlert(id) {
        try {
            const res = await fetch(`${this.apiBase}/workflows/alerts/${id}/complete`, {
                method: 'POST',
                headers: this.getHeaders()
            });
            const data = await res.json();
            if (data.success) {
                await this.loadWorkflowTab();
            }
        } catch (err) {
            alert("❌ Nelze označit za splněné: " + err.message);
        }
    }

    // --- TIME-TRACKING TAB INTEGRATIONS ---

    async loadTimeTrackingTab() {
        try {
            console.log("🕒 Načítám Time-tracking tab...");
            
            // Get today's activity stats
            const resToday = await fetch(`${this.apiBase}/activity/today`, { headers: this.getHeaders() });
            const dataToday = await resToday.json();

            // Get generated timesheets
            const resTimesheets = await fetch(`${this.apiBase}/activity/timesheets`, { headers: this.getHeaders() });
            const dataTimesheets = await resTimesheets.json();

            if (dataToday.success) {
                this.renderTodayActivities(dataToday.aggregated, dataToday.rawLogsCount);
            }
            if (dataTimesheets.success) {
                this.renderTimesheetsHistory(dataTimesheets.timesheets);
            }
        } catch (err) {
            console.error("❌ Selhalo načítání Time-tracking tab:", err);
        }
    }

    renderTodayActivities(aggregated, rawCount) {
        const totalHoursEl = document.getElementById('time-stat-total');
        const countEl = document.getElementById('time-stat-count');
        const listEl = document.getElementById('time-today-activity-list');

        let totalHours = 0;
        aggregated.forEach(item => totalHours += item.totalHours);

        if (totalHoursEl) totalHoursEl.textContent = `${totalHours.toFixed(1)} hod`;
        if (countEl) countEl.textContent = rawCount;

        if (!listEl) return;

        if (aggregated.length === 0) {
            listEl.innerHTML = `<div style="text-align: center; opacity: 0.6; padding: 20px;">Dnes nebyla zaznamenána žádná aktivita v editoru.</div>`;
            return;
        }

        listEl.innerHTML = aggregated.map(item => `
            <div class="glass" style="padding: 10px 15px; border-radius: 8px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-glass); font-size: 0.85rem; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <strong style="color: white; display: block; margin-bottom: 2px;">${item.documentName}</strong>
                    <span style="opacity: 0.7; font-size: 0.75rem;">Primární úkon: <code>${item.primaryAction}</code></span>
                </div>
                <div style="text-align: right;">
                    <strong style="color: var(--accent-gold); font-size: 0.9rem; display: block;">${item.totalHours.toFixed(2)} hod</strong>
                    <span style="opacity: 0.7; font-size: 0.7rem;">(Změn: ${item.saves})</span>
                </div>
            </div>
        `).join('');
    }

    renderTimesheetsHistory(timesheets) {
        const listEl = document.getElementById('timesheets-history-list');
        if (!listEl) return;

        if (timesheets.length === 0) {
            listEl.innerHTML = `<div style="text-align: center; opacity: 0.6; padding: 30px;">Zatím nebyly sestaveny žádné výkazy.</div>`;
            return;
        }

        // Sort descending
        const sorted = [...timesheets].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

        listEl.innerHTML = sorted.map(ts => `
            <div class="glass" style="padding: 18px; border-radius: 12px; background: rgba(255,255,255,0.01); border: 1px solid var(--border-glass);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <div>
                        <strong style="color: white; font-size: 1rem; font-family: 'Outfit', sans-serif;">📋 Výkaz práce ze dne ${ts.date}</strong>
                        <span style="opacity: 0.6; font-size: 0.75rem; display: block;">Sestaveno: ${new Date(ts.createdAt).toLocaleString('cs-CZ')}</span>
                    </div>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <span style="color: var(--accent-gold); font-weight: bold; font-size: 0.95rem;">${ts.totalHours.toFixed(1)} hod celkem</span>
                        <button class="btn btn-secondary" onclick="window.appInstance.copyTimesheetToClipboard('${ts.id}')" style="padding: 4px 8px; font-size: 0.75rem; background: rgba(255,255,255,0.05); border: 1px solid var(--border-glass);">
                            Kopírovat 📋
                        </button>
                    </div>
                </div>
                <div class="glass" style="padding: 12px 15px; border-radius: 8px; font-family: 'Outfit', sans-serif; font-size: 0.85rem; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.02); white-space: pre-wrap; color: #cbd5e1; max-height: 200px; overflow-y: auto;" id="ts-text-${ts.id}">${ts.synthesizedOutput}</div>
            </div>
        `).join('');
    }

    async generateTimesheet() {
        const model = document.getElementById('timesheet-model-select').value || 'llama3';
        
        try {
            console.log("🕒 Spouštím generování timesheetu přes Ollama...");
            const res = await fetch(`${this.apiBase}/activity/timesheet`, {
                method: 'POST',
                headers: {
                    ...this.getHeaders(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ model })
            });

            const data = await res.json();
            if (data.success) {
                alert("✓ Denní výkaz práce byl úspěšně vygenerován lokální AI a šifrovaně uložen.");
                await this.loadTimeTrackingTab();
            } else {
                alert("❌ Chyba při generování: " + data.message);
            }
        } catch (err) {
            alert("❌ Síťové selhání při generování výkazu: " + err.message);
        }
    }

    // --- RISKS & COMPLIANCE TAB INTEGRATIONS ---

    async loadRisksTab() {
        try {
            console.log("🔍 Načítám tab Hlídač rizik...");
            
            // Get history of conflict checks
            const resConflicts = await fetch(`${this.apiBase}/conflicts/history`, { headers: this.getHeaders() });
            const dataConflicts = await resConflicts.json();

            if (dataConflicts.success) {
                this.renderConflictsHistory(dataConflicts.history);
            }
        } catch (err) {
            console.error("❌ Nelze načíst data pro tab rizik:", err);
        }
    }

    renderConflictsHistory(history) {
        const listEl = document.getElementById('conflicts-history-list');
        if (!listEl) return;

        if (history.length === 0) {
            listEl.innerHTML = `<div style="text-align: center; opacity: 0.6; padding: 20px;">Žádné historické prověrky.</div>`;
            return;
        }

        // Sort descending by timestamp
        const sorted = [...history].sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));

        listEl.innerHTML = sorted.map(run => {
            const isHigh = run.riskLevel === 'high';
            const isMedium = run.riskLevel === 'medium';
            const badgeColor = isHigh ? '#f87171' : isMedium ? '#fbbf24' : '#4ade80';
            const badgeText = isHigh ? 'VYSOKÉ RIZIKO' : isMedium ? 'Střední riziko' : 'Bezpečné ✓';

            return `
                <div class="glass" style="padding: 15px; border-radius: 10px; background: rgba(255,255,255,0.01); border: 1px solid var(--border-glass); font-size: 0.85rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <div>
                            <strong style="color: white; font-size: 0.95rem;">Prověrka střetu zájmů</strong>
                            <span style="opacity: 0.6; font-size: 0.75rem; display: block;">Prověřeno: ${new Date(run.timestamp).toLocaleString('cs-CZ')}</span>
                        </div>
                        <span style="font-size: 0.75rem; padding: 3px 8px; border-radius: 4px; font-weight: bold; background: ${badgeColor}20; color: ${badgeColor}; border: 1px solid ${badgeColor}30;">
                            ${badgeText}
                        </span>
                    </div>
                    <div style="margin-bottom: 8px;">
                        <span style="opacity: 0.8;">Klient: <strong>${run.clientName}</strong> | Protistrana: <strong>${run.counterpartyName}</strong></span>
                    </div>
                    <p style="margin: 0; font-size: 0.8rem; opacity: 0.9; color: ${isHigh ? '#f87171' : 'white'};">${run.description}</p>
                    ${run.conflictsFound && run.conflictsFound.length > 0 ? `
                        <div style="margin-top: 10px; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 6px; border: 1px solid rgba(255,255,255,0.03);">
                            <span style="font-size: 0.75rem; font-weight: bold; color: var(--accent-gold); display: block; margin-bottom: 5px;">Detaily nalezeného konfliktu:</span>
                            ${run.conflictsFound.map(c => `
                                <div style="font-size: 0.75rem; margin-bottom: 4px; opacity: 0.9;">
                                    • Shoda v souboru: <code>${c.fileName}</code> (sémantická váha: ${(c.score * 100).toFixed(0)}%)
                                    <span style="display: block; opacity: 0.6; font-style: italic; margin-left: 10px;">"${c.textSnippet}"</span>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    }

    async runConflictCheck(e) {
        e.preventDefault();
        const clientName = document.getElementById('conflict-client-name').value;
        const counterpartyName = document.getElementById('conflict-opponent-name').value;

        try {
            const res = await fetch(`${this.apiBase}/conflicts/check`, {
                method: 'POST',
                headers: {
                    ...this.getHeaders(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ clientName, counterpartyName })
            });

            const data = await res.json();
            if (data.success) {
                const report = data.report;
                const panel = document.getElementById('conflict-result-panel');
                const badge = document.getElementById('conflict-risk-badge');
                const desc = document.getElementById('conflict-risk-desc');

                panel.style.display = 'block';
                desc.textContent = report.description;

                const isHigh = report.riskLevel === 'high';
                const isMedium = report.riskLevel === 'medium';
                badge.textContent = isHigh ? 'VYSOKÉ RIZIKO' : isMedium ? 'Střední riziko' : 'Bezpečné ✓';
                badge.style.background = isHigh ? 'rgba(239,68,68,0.2)' : isMedium ? 'rgba(251,191,36,0.2)' : 'rgba(52,211,153,0.2)';
                badge.style.color = isHigh ? '#f87171' : isMedium ? '#fbbf24' : '#34d399';
                badge.style.border = `1px solid ${isHigh ? '#f87171' : isMedium ? '#fbbf24' : '#34d399'}30`;

                await this.loadRisksTab();
            } else {
                alert("❌ Chyba prověrky střetu zájmů: " + data.error);
            }
        } catch (err) {
            alert("❌ Síťová chyba prověrky: " + err.message);
        }
    }

    async runComplianceCheck(e) {
        e.preventDefault();
        const documentName = document.getElementById('compliance-doc-name').value;
        const content = document.getElementById('compliance-doc-text').value;

        try {
            const res = await fetch(`${this.apiBase}/judikatura/check`, {
                method: 'POST',
                headers: {
                    ...this.getHeaders(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ content, documentName })
            });

            const data = await res.json();
            if (data.success || data.compliant !== undefined) {
                const panel = document.getElementById('compliance-result-panel');
                const badge = document.getElementById('compliance-status-badge');
                const container = document.getElementById('compliance-alerts-container');

                panel.style.display = 'block';

                badge.textContent = data.compliant ? 'Plně vyhovující ✓' : 'NALEZEN NESOULAD ⚠️';
                badge.style.background = data.compliant ? 'rgba(52,211,153,0.2)' : 'rgba(239,68,68,0.2)';
                badge.style.color = data.compliant ? '#34d399' : '#f87171';
                badge.style.border = `1px solid ${data.compliant ? '#34d399' : '#f87171'}30`;

                if (data.compliant) {
                    container.innerHTML = `<div style="color: #34d399; font-weight: bold; padding: 10px 0;">✓ Dokument vyhovuje všem prověřovaným judikátům Nejvyššího soudu a e-Sbírky.</div>`;
                } else {
                    container.innerHTML = data.alerts.map(alert => `
                        <div class="glass" style="padding: 12px; border-radius: 8px; background: rgba(239,68,68,0.02); border: 1px solid rgba(239,68,68,0.2); margin-top: 10px;">
                            <div style="font-weight: bold; color: #f87171; margin-bottom: 5px;">⚠️ Nesoulad s ${alert.benchmarkTitle}</div>
                            <div style="font-size: 0.8rem; margin-bottom: 8px; opacity: 0.9;">Téma: <strong>${alert.topic}</strong></div>
                            <div style="font-size: 0.8rem; margin-bottom: 8px; opacity: 0.8; font-style: italic;">"${alert.description}"</div>
                            <div style="font-size: 0.8rem; padding: 8px; background: rgba(52,211,153,0.05); border: 1px solid rgba(52,211,153,0.2); border-radius: 6px; color: #a7f3d0;">
                                <strong style="display: block; margin-bottom: 3px; color: #34d399;">Doporučené znění opravy:</strong>
                                ${alert.suggestedRemedy}
                            </div>
                        </div>
                    `).join('');
                }
            } else {
                alert("❌ Selhala analýza compliance.");
            }
        } catch (err) {
            alert("❌ Síťová chyba analýzy: " + err.message);
        }
    }

    // --- MANAGERIAL INTELLIGENCE TAB INTEGRATIONS ---

    async loadManagerialTab() {
        try {
            console.log("📊 Načítám tab Manažerské přehledy...");
            
            // Fetch profitability report
            const resProfitability = await fetch(`${this.apiBase}/managerial/profitability`, { headers: this.getHeaders() });
            const dataProfitability = await resProfitability.json();

            // Fetch capacity workload report
            const resCapacity = await fetch(`${this.apiBase}/managerial/capacity`, { headers: this.getHeaders() });
            const dataCapacity = await resCapacity.json();

            // Fetch office default hourly rate setting
            const resSettings = await fetch(`${this.apiBase}/managerial/settings`, { headers: this.getHeaders() });
            const dataSettings = await resSettings.json();
            if (dataSettings.success && dataSettings.settings) {
                const defaultRateInput = document.getElementById('office-default-rate');
                if (defaultRateInput) {
                    defaultRateInput.value = dataSettings.settings.defaultHourlyRate;
                }
            }

            // Fetch fee list (ceník)
            const resFees = await fetch(`${this.apiBase}/managerial/fees`, { headers: this.getHeaders() });
            const dataFees = await resFees.json();

            if (dataProfitability.success) {
                this.renderProfitability(dataProfitability.report);
            }
            if (dataCapacity.success) {
                this.renderCapacity(dataCapacity.allocation);
            }
            if (dataFees.success) {
                this.renderFeesList(dataFees.fees);
            }
        } catch (err) {
            console.error("❌ Nelze načíst manažerská data:", err);
        }
    }

    renderProfitability(report) {
        const listEl = document.getElementById('managerial-profitability-list');
        if (!listEl) return;

        if (report.length === 0) {
            listEl.innerHTML = `<div style="text-align: center; opacity: 0.6; padding: 20px;">Žádné rozpracované spisy s nastavenými budgety.</div>`;
            return;
        }

        listEl.innerHTML = report.map(item => {
            const isUnprofitable = item.status === 'unprofitable';
            const isWarning = item.status === 'warning';
            const statusColor = isUnprofitable ? '#f87171' : isWarning ? '#fbbf24' : '#4ade80';
            const barFill = Math.min(item.spentPercentage, 100);

            return `
                <div class="glass" style="padding: 15px; border-radius: 12px; background: rgba(255,255,255,0.01); border: 1px solid var(--border-glass);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <div>
                            <strong style="color: white; font-size: 0.95rem; font-family: 'Outfit', sans-serif;">📄 ${item.documentName}</strong>
                            <span style="opacity: 0.6; font-size: 0.75rem; display: block;">Typ: <code>${item.budgetType}</code> | Sazba: ${item.hourlyRate} Kč/hod</span>
                        </div>
                        <div style="text-align: right;">
                            <span style="font-weight: bold; color: ${statusColor}; font-size: 0.95rem;">${item.actualHours.toFixed(1)} / ${item.limitHours} hod</span>
                            <span style="opacity: 0.6; font-size: 0.75rem; display: block;">(Čerpáno: ${item.spentPercentage}%)</span>
                        </div>
                    </div>
                    
                    <!-- Progress Bar -->
                    <div style="width: 100%; height: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; overflow: hidden; margin-bottom: 10px; border: 1px solid rgba(255,255,255,0.02);">
                        <div style="width: ${barFill}%; height: 100%; background: ${statusColor}; border-radius: 4px; transition: width 0.3s ease;"></div>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem;">
                        <span style="opacity: 0.7;">Odhadované náklady na práci:</span>
                        <strong style="color: white;">${item.estimatedCost.toLocaleString('cs-CZ')} Kč</strong>
                    </div>
                </div>
            `;
        }).join('');
    }

    renderCapacity(allocation) {
        const listEl = document.getElementById('managerial-capacity-list');
        if (!listEl) return;

        listEl.innerHTML = allocation.staff.map(member => {
            const isOverloaded = member.status === 'overloaded';
            const isUnderloaded = member.status === 'underloaded';
            const statusColor = isOverloaded ? '#f87171' : isUnderloaded ? '#60a5fa' : '#4ade80';
            const statusText = isOverloaded ? 'PŘETÍŽENÍ' : isUnderloaded ? 'Volné kapacity' : 'Ideální vytížení';

            return `
                <div class="glass" style="padding: 15px; border-radius: 12px; background: rgba(255,255,255,0.01); border: 1px solid var(--border-glass); display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <strong style="color: white; font-size: 0.95rem; font-family: 'Outfit', sans-serif; display: block; margin-bottom: 2px;">${member.name}</strong>
                        <span style="opacity: 0.7; font-size: 0.75rem;">Role: ${member.role} | Aktivní úkolová zátěž: <strong>${member.load.toFixed(1)}</strong></span>
                    </div>
                    <div>
                        <span style="font-size: 0.75rem; padding: 4px 10px; border-radius: 20px; font-weight: bold; background: ${statusColor}20; color: ${statusColor}; border: 1px solid ${statusColor}30;">
                            ${statusText}
                        </span>
                    </div>
                </div>
            `;
        }).join('');
    }

    async saveBudget(e) {
        e.preventDefault();
        const documentName = document.getElementById('budget-doc-name').value;
        const budgetType = document.getElementById('budget-type').value;
        const limitHours = parseFloat(document.getElementById('budget-hours').value);
        const hourlyRateVal = document.getElementById('budget-rate').value;
        const hourlyRate = hourlyRateVal ? parseFloat(hourlyRateVal) : null;

        try {
            const res = await fetch(`${this.apiBase}/managerial/budgets`, {
                method: 'POST',
                headers: {
                    ...this.getHeaders(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ documentName, budgetType, limitHours, hourlyRate })
            });

            const data = await res.json();
            if (data.success) {
                alert("✓ Rozpočet spisu byl úspěšně nakonfigurován a šifrovaně uložen.");
                document.getElementById('managerial-budget-form').reset();
                await this.loadManagerialTab();
            } else {
                alert("❌ Chyba při ukládání rozpočtu: " + data.error);
            }
        } catch (err) {
            alert("❌ Síťové selhání: " + err.message);
        }
    }

    async saveOfficeRate(e) {
        e.preventDefault();
        const defaultHourlyRate = parseFloat(document.getElementById('office-default-rate').value);

        try {
            const res = await fetch(`${this.apiBase}/managerial/settings`, {
                method: 'POST',
                headers: {
                    ...this.getHeaders(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ defaultHourlyRate })
            });

            const data = await res.json();
            if (data.success) {
                alert("✓ Výchozí hodinová sazba kanceláře byla uložena a zašifrována.");
                await this.loadManagerialTab();
            } else {
                alert("❌ Chyba při ukládání sazby: " + data.error);
            }
        } catch (err) {
            alert("❌ Síťové selhání: " + err.message);
        }
    }

    renderFeesList(fees) {
        const listEl = document.getElementById('managerial-fees-list');
        if (!listEl) return;

        if (fees.length === 0) {
            listEl.innerHTML = `<div style="text-align: center; opacity: 0.6; padding: 20px;">Ceník je prázdný.</div>`;
            return;
        }

        listEl.innerHTML = fees.map(fee => {
            const isHourly = fee.type === 'hourly';
            const typeLabel = isHourly ? 'Kč/hod' : 'Kč (paušál)';
            const typeBadgeColor = isHourly ? 'var(--accent-blue)' : 'var(--accent-purple)';

            return `
                <div class="glass" style="padding: 12px 15px; border-radius: 8px; background: rgba(255,255,255,0.01); border: 1px solid var(--border-glass); display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem;">
                    <div>
                        <strong style="color: white; display: block; margin-bottom: 2px;">${fee.name}</strong>
                        <span style="font-size: 0.72rem; padding: 1px 6px; border-radius: 4px; font-weight: bold; background: ${typeBadgeColor}15; color: ${typeBadgeColor}; border: 1px solid ${typeBadgeColor}25;">
                            ${isHourly ? 'Hodinová' : 'Paušální'}
                        </span>
                    </div>
                    <div style="display: flex; gap: 12px; align-items: center;">
                        <strong style="color: var(--accent-gold); font-size: 0.95rem;">${fee.amount.toLocaleString('cs-CZ')} ${typeLabel}</strong>
                        <div style="display: flex; gap: 6px;">
                            <button class="btn btn-secondary btn-sm" onclick="window.appInstance.editFeeItem('${fee.id}', '${fee.name.replace(/'/g, "\\'")}', '${fee.type}', ${fee.amount})" style="padding: 3px 6px; font-size: 0.75rem;">✏️</button>
                            <button class="btn btn-secondary btn-sm" onclick="window.appInstance.deleteFeeItem('${fee.id}')" style="padding: 3px 6px; font-size: 0.75rem; background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.2); color: #f87171;">🗑️</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    toggleFeeForm(show) {
        const form = document.getElementById('fee-rule-form');
        if (!form) return;

        if (show) {
            form.style.display = 'flex';
            document.getElementById('fee-id').value = '';
            document.getElementById('fee-name').value = '';
            document.getElementById('fee-type').value = 'hourly';
            document.getElementById('fee-amount').value = '';
            document.getElementById('fee-name').focus();
        } else {
            form.style.display = 'none';
            form.reset();
        }
    }

    editFeeItem(id, name, type, amount) {
        const form = document.getElementById('fee-rule-form');
        if (!form) return;

        form.style.display = 'flex';
        document.getElementById('fee-id').value = id;
        document.getElementById('fee-name').value = name;
        document.getElementById('fee-type').value = type;
        document.getElementById('fee-amount').value = amount;
        document.getElementById('fee-name').focus();
    }

    async saveFeeItem(e) {
        e.preventDefault();
        const id = document.getElementById('fee-id').value;
        const name = document.getElementById('fee-name').value;
        const type = document.getElementById('fee-type').value;
        const amount = parseFloat(document.getElementById('fee-amount').value);

        try {
            const res = await fetch(`${this.apiBase}/managerial/fees`, {
                method: 'POST',
                headers: {
                    ...this.getHeaders(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ id: id || undefined, name, type, amount })
            });

            const data = await res.json();
            if (data.success) {
                this.toggleFeeForm(false);
                await this.loadManagerialTab();
            } else {
                alert("❌ Chyba při ukládání položky: " + data.error);
            }
        } catch (err) {
            alert("❌ Síťové selhání: " + err.message);
        }
    }

    async deleteFeeItem(id) {
        if (!confirm("Opravdu chcete smazat tuto položku z ceníku?")) return;
        try {
            const res = await fetch(`${this.apiBase}/managerial/fees/${id}`, {
                method: 'DELETE',
                headers: this.getHeaders()
            });
            const data = await res.json();
            if (data.success) {
                await this.loadManagerialTab();
            } else {
                alert("❌ Chyba při mazání položky: " + data.error);
            }
        } catch (err) {
            alert("❌ Nelze smazat položku: " + err.message);
        }
    }

    openQuickTimeLogModal() {
        const dialog = document.getElementById('dialog-quick-timelog');
        if (!dialog) return;
        
        document.getElementById('form-quick-timelog').reset();
        const todayStr = new Date().toISOString().split('T')[0];
        document.getElementById('qtl-date').value = todayStr;
        
        dialog.showModal();
    }

    async saveQuickTimeLog(e) {
        e.preventDefault();
        const documentName = document.getElementById('qtl-case').value.trim();
        const date = document.getElementById('qtl-date').value;
        const hours = parseFloat(document.getElementById('qtl-hours').value);
        const description = document.getElementById('qtl-description').value.trim();
        
        try {
            console.log(`🕒 Ukládám ruční výkaz práce pro [${documentName}]...`);
            const res = await fetch(`${this.apiBase}/activity/custom`, {
                method: 'POST',
                headers: this.getHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                    documentName,
                    hours,
                    date,
                    actionType: description
                })
            });
            
            const data = await res.json();
            if (data.success) {
                alert(`✓ Úkon byl úspěšně zaznamenán.`);
                document.getElementById('dialog-quick-timelog').close();
                
                if (this.activeTab === 'timetracking') {
                    await this.loadTimeTrackingTab();
                } else if (this.activeTab === 'overview') {
                    await this.checkSystemStatus();
                }
            } else {
                alert("❌ Chyba při ukládání úkonu: " + data.error);
            }
        } catch (err) {
            alert("❌ Síťové selhání při zápisu času: " + err.message);
        }
    }

    async loadInlineTimelineData(caseNum) {
        const caseNumSanitized = caseNum.replace(/[^a-zA-Z0-9-_]/g, '_');
        const listEl = document.getElementById(`timeline-events-${caseNumSanitized}`);
        if (!listEl) return;
        
        try {
            console.log(`⏱️ Načítám časovou osu pro spis [${caseNum}]...`);
            const res = await fetch(`${this.apiBase}/inbox/case/${encodeURIComponent(caseNum)}/timeline`, {
                headers: this.getHeaders()
            });
            const data = await res.json();
            
            if (data.success && data.timeline) {
                if (data.timeline.length === 0) {
                    listEl.innerHTML = `<div style="text-align: center; padding: 15px; opacity: 0.6; font-size: 0.8rem;">Žádná zaznamenaná historie pro tento spis.</div>`;
                    return;
                }
                
                listEl.innerHTML = data.timeline.map(item => {
                    const dateStr = new Date(item.timestamp).toLocaleString('cs-CZ');
                    return `
                        <div class="timeline-item" style="margin-bottom: 12px;">
                            <div class="timeline-icon">${item.icon || '⚫'}</div>
                            <div class="timeline-content">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                    <strong style="color: white; font-size: 0.82rem;">${item.title}</strong>
                                    <span style="font-size: 0.68rem; opacity: 0.6;">${dateStr}</span>
                                </div>
                                <span style="font-size: 0.76rem; opacity: 0.85; color: #cbd5e1; display: block; line-height: 1.4;">${item.description}</span>
                            </div>
                        </div>
                    `;
                }).join('');
            } else {
                listEl.innerHTML = `<div style="text-align: center; padding: 15px; color: var(--accent-red); font-size: 0.8rem;">❌ Chyba načítání: ${escapeHtml(data.error)}</div>`;
            }
        } catch (err) {
            listEl.innerHTML = `<div style="text-align: center; padding: 15px; color: var(--accent-red); font-size: 0.8rem;">❌ Síťová chyba: ${escapeHtml(err.message)}</div>`;
        }
    }

    async showCaseTimeline(caseNum) {
        const caseNumSanitized = caseNum.replace(/[^a-zA-Z0-9-_]/g, '_');
        const collapseEl = document.getElementById(`timeline-collapse-${caseNumSanitized}`);
        const listEl = document.getElementById(`timeline-events-${caseNumSanitized}`);
        const btnToggle = document.getElementById(`btn-timeline-toggle-${caseNumSanitized}`);
        
        if (!collapseEl || !listEl || !btnToggle) {
            // Fallback to dialog if DOM elements for inline are not found
            const dialog = document.getElementById('dialog-case-timeline');
            const caseLabel = document.getElementById('timeline-case-number');
            const dialogListEl = document.getElementById('timeline-events-list');
            if (dialog && caseLabel && dialogListEl) {
                caseLabel.textContent = `sp. zn. ${caseNum}`;
                dialogListEl.innerHTML = `<div style="text-align: center; padding: 30px; opacity: 0.6; font-size: 0.85rem;">Načítám časovou osu spisu...</div>`;
                dialog.showModal();
                try {
                    const res = await fetch(`${this.apiBase}/inbox/case/${encodeURIComponent(caseNum)}/timeline`, {
                        headers: this.getHeaders()
                    });
                    const data = await res.json();
                    if (data.success && data.timeline) {
                        if (data.timeline.length === 0) {
                            dialogListEl.innerHTML = `<div style="text-align: center; padding: 30px; opacity: 0.6; font-size: 0.85rem;">Žádná zaznamenaná historie pro tento spis.</div>`;
                            return;
                        }
                        dialogListEl.innerHTML = data.timeline.map(item => {
                            const dateStr = new Date(item.timestamp).toLocaleString('cs-CZ');
                            return `
                                <div class="timeline-item">
                                    <div class="timeline-icon">${item.icon || '⚫'}</div>
                                    <div class="timeline-content">
                                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                            <strong style="color: white; font-size: 0.85rem;">${item.title}</strong>
                                            <span style="font-size: 0.7rem; opacity: 0.6;">${dateStr}</span>
                                        </div>
                                        <span style="font-size: 0.78rem; opacity: 0.85; color: #cbd5e1; display: block; line-height: 1.4;">${item.description}</span>
                                    </div>
                                </div>
                            `;
                        }).join('');
                    } else {
                        dialogListEl.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--accent-red); font-size: 0.85rem;">❌ Chyba: ${escapeHtml(data.error)}</div>`;
                    }
                } catch (err) {
                    dialogListEl.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--accent-red); font-size: 0.85rem;">❌ Síťová chyba: ${escapeHtml(err.message)}</div>`;
                }
            }
            return;
        }

        // Inline toggle logic
        if (collapseEl.style.display === 'none') {
            // Open the collapse
            collapseEl.style.display = 'block';
            this.expandedTimelines.add(caseNum);
            
            btnToggle.innerHTML = `✕ Skrýt historii`;
            btnToggle.style.background = 'rgba(239, 68, 68, 0.08)';
            btnToggle.style.borderColor = 'rgba(239, 68, 68, 0.25)';
            btnToggle.style.color = '#f87171';
            
            listEl.innerHTML = `<div style="text-align: center; padding: 15px; opacity: 0.6; font-size: 0.8rem;">Načítám historii spisu...</div>`;
            
            await this.loadInlineTimelineData(caseNum);
        } else {
            // Close the collapse
            collapseEl.style.display = 'none';
            this.expandedTimelines.delete(caseNum);
            
            btnToggle.innerHTML = `⏱️ Časová osa spisu`;
            btnToggle.style.background = 'rgba(59, 130, 246, 0.08)';
            btnToggle.style.borderColor = 'rgba(59, 130, 246, 0.25)';
            btnToggle.style.color = '#60a5fa';
        }
    }

    // ─── E-mailové úkoly a AI Asistenti ──────────────────────────────────────────────

    async loadEmailSettings() {
        try {
            const res = await fetch(`${this.apiBase}/email/settings`, {
                headers: this.getHeaders()
            });
            const data = await res.json();
            if (data.success) {
                this.emailSettings = data.settings;
            }
        } catch (e) {
            console.error("Chyba při načítání nastavení emailu:", e);
        }
    }

    async loadEmailTasks() {
        try {
            const res = await fetch(`${this.apiBase}/email/tasks`, {
                headers: this.getHeaders()
            });
            const data = await res.json();
            if (data.success) {
                this.emailTasks = data.tasks;
            }
        } catch (e) {
            console.error("Chyba při načítání emailových úkolů:", e);
        }
    }

    async saveEmailSettings(e) {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;
        
        const settings = {
            authorized_sender: document.getElementById('em-auth-sender').value.trim(),
            recipient_filter: document.getElementById('em-recip-filter').value.trim(),
            imap_host: document.getElementById('em-imap-host').value.trim(),
            imap_port: document.getElementById('em-imap-port').value.trim(),
            imap_user: document.getElementById('em-imap-user').value.trim(),
            imap_ssl: document.getElementById('em-imap-ssl').checked,
            smtp_host: document.getElementById('em-smtp-host').value.trim(),
            smtp_port: document.getElementById('em-smtp-port').value.trim(),
            smtp_user: document.getElementById('em-smtp-user').value.trim(),
            smtp_ssl: document.getElementById('em-smtp-ssl').checked
        };
        
        try {
            const res = await fetch(`${this.apiBase}/email/settings`, {
                method: 'POST',
                headers: this.getHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(settings)
            });
            const data = await res.json();
            if (data.success) {
                alert("✓ Nastavení e-mailu bylo úspěšně uloženo.");
                this.emailSettings = settings;
                this.renderInbox();
            } else {
                alert("❌ Chyba: " + data.error);
            }
        } catch (err) {
            alert("❌ Síťová chyba: " + err.message);
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    openEmailSimulationModal() {
        const dialog = document.getElementById('dialog-email-simulation');
        if (!dialog) return;
        
        // Předvyplnit odesílatele autorizovaným e-mailem advokáta
        const senderInput = document.getElementById('ems-sender');
        if (senderInput && this.emailSettings && this.emailSettings.authorized_sender) {
            senderInput.value = this.emailSettings.authorized_sender;
        }
        
        // Vyčistit předmět a tělo
        const subjectInput = document.getElementById('ems-subject');
        if (subjectInput) subjectInput.value = '';
        const bodyInput = document.getElementById('ems-body');
        if (bodyInput) bodyInput.value = '';
        
        dialog.showModal();
    }

    async submitEmailSimulation(e) {
        e.preventDefault();
        const dialog = document.getElementById('dialog-email-simulation');
        const btn = e.target.querySelector('button[type="submit"]');
        if (btn) {
            btn.disabled = true;
            btn.textContent = "AI asistent zpracovává úkol... 🤖";
        }
        
        const taskData = {
            sender: document.getElementById('ems-sender').value.trim(),
            subject: document.getElementById('ems-subject').value.trim(),
            body: document.getElementById('ems-body').value.trim()
        };
        
        try {
            const res = await fetch(`${this.apiBase}/email/simulate`, {
                method: 'POST',
                headers: this.getHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(taskData)
            });
            const data = await res.json();
            if (data.success) {
                if (dialog) dialog.close();
                alert(`✓ Úkol byl úspěšně zpracován asistentem (${data.task.assignedAgentName} ${data.task.assignedAgentEmoji}) a odpověď odeslána zpět advokátovi!`);
                await this.loadEmailTasks();
                this.renderInbox();
            } else {
                alert("❌ Chyba: " + data.error);
            }
        } catch (err) {
            alert("❌ Síťová chyba při simulaci: " + err.message);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = "Odeslat úkol asistentovi 🚀";
            }
        }
    }

    async deleteEmailTask(id) {
        if (!confirm("Opravdu chcete tento e-mailový úkol smazat z historie?")) return;
        try {
            const res = await fetch(`${this.apiBase}/email/tasks/${id}`, {
                method: 'DELETE',
                headers: this.getHeaders()
            });
            const data = await res.json();
            if (data.success) {
                await this.loadEmailTasks();
                this.renderInbox();
            } else {
                alert("❌ Chyba při mazání: " + data.error);
            }
        } catch (err) {
            alert("❌ Síťová chyba při mazání: " + err.message);
        }
    }

    renderEmailTasks() {
        const container = document.getElementById('inbox-container');
        if (!container) return;

        // Nabindovat znovu filter buttony pokud je to nutné
        document.querySelectorAll('.filter-btn').forEach(btn => {
            if (!btn.dataset.bound) {
                btn.dataset.bound = "true";
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.renderInbox();
                });
            }
        });

        const s = this.emailSettings || {
            authorized_sender: 'advokat@dias.cz',
            recipient_filter: 'dias+asistenti@advokatnikancelar.cz',
            imap_host: 'imap.advokatnikancelar.cz',
            imap_port: '993',
            imap_user: 'dias@advokatnikancelar.cz',
            imap_ssl: true,
            smtp_host: 'smtp.advokatnikancelar.cz',
            smtp_port: '465',
            smtp_user: 'dias@advokatnikancelar.cz',
            smtp_ssl: true
        };

        let tasksHtml = '';
        if (this.emailTasks.length === 0) {
            tasksHtml = `
                <div class="empty-state" style="padding: 40px 20px; border: 1px dashed var(--border-glass); border-radius: 12px;">
                    <div class="empty-icon" style="font-size: 2.5rem; margin-bottom: 10px;">📧</div>
                    <h3 style="font-size: 1rem; margin-bottom: 5px; color: white;">Žádné e-mailové úkoly</h3>
                    <p style="font-size: 0.8rem; max-width: 320px; margin: auto; opacity: 0.7;">Pošlete e-mail na schránku asistentů nebo použijte simulátor v levém panelu.</p>
                </div>
            `;
        } else {
            tasksHtml = this.emailTasks.map(task => {
                const dateStr = new Date(task.createdAt).toLocaleString('cs-CZ');
                const safeSubject = escapeHtml(task.subject).replace(/"/g, '&quot;');
                const escapedResponse = escapeHtml(task.responseSent).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
                
                return `
                    <div class="glass email-task-card" style="border: 1px solid var(--border-glass); border-radius: 12px; padding: 18px; display: flex; flex-direction: column; gap: 12px; background: rgba(15, 23, 42, 0.35); transition: border-color 0.2s;">
                        <div style="display: flex; justify-content: space-between; align-items: start;">
                            <div>
                                <span style="font-size: 0.72rem; color: var(--text-muted); display: block; margin-bottom: 2px;">Doručeno: ${dateStr}</span>
                                <strong style="color: white; font-size: 0.95rem; font-family: 'Outfit', sans-serif;">${escapeHtml(task.subject)}</strong>
                                <span style="font-size: 0.75rem; color: #94a3b8; display: block; margin-top: 2px;">Od: ${escapeHtml(task.sender)}</span>
                            </div>
                            <span style="background: rgba(59,130,246,0.12); border: 1px solid rgba(59,130,246,0.25); padding: 4px 10px; border-radius: 20px; font-size: 0.75rem; color: #93c5fd; font-weight: 600; display: flex; align-items: center; gap: 4px;">
                                ${escapeHtml(task.assignedAgentEmoji)} ${escapeHtml(task.assignedAgentName)}
                            </span>
                        </div>
                        
                        <div style="background: rgba(0,0,0,0.2); padding: 10px 14px; border-radius: 8px; font-size: 0.82rem; color: #cbd5e1; border-left: 3px solid var(--accent-blue);">
                            <strong style="color: white;">Zadání v e-mailu:</strong><br/>
                            <span style="display: block; margin-top: 4px; line-height: 1.4;">${escapeHtml(task.body)}</span>
                        </div>
                        
                        <div style="margin-top: 5px;">
                            <span style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 5px;">Odpověď odeslaná advokátovi:</span>
                            <div style="background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(255,255,255,0.06); padding: 12px; border-radius: 8px; font-family: 'Fira Code', 'Courier New', monospace; font-size: 0.78rem; color: #e2e8f0; max-height: 200px; overflow-y: auto; white-space: pre-wrap; line-height: 1.4; scrollbar-gutter: stable;">${escapeHtml(task.responseSent)}</div>
                        </div>
                        
                        <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 10px; margin-top: 5px;">
                            <button class="btn btn-secondary" onclick="window.appInstance.sendTextToLexisEditor('${escapedResponse}', 'Odpověd na email: ${safeSubject}')" style="font-size: 0.75rem; padding: 6px 12px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.02); color: white;">
                                ✍️ Odeslat do Editoru
                            </button>
                            <button class="btn btn-secondary" onclick="window.appInstance.deleteEmailTask('${task.id}')" style="font-size: 0.75rem; padding: 6px 12px; border: 1px solid rgba(239,68,68,0.2); background: rgba(239,68,68,0.02); color: #f87171;">
                                🗑️ Smazat
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        container.innerHTML = `
            <div class="email-tasks-layout" style="display: grid; grid-template-columns: 1fr 1.8fr; gap: 25px; margin-top: 15px; align-items: start;">
                <!-- Settings Panel -->
                <div class="glass" style="border: 1px solid var(--border-glass); border-radius: 14px; padding: 20px; background: rgba(30, 41, 59, 0.25); backdrop-filter: blur(12px);">
                    <h3 style="margin-top: 0; margin-bottom: 15px; display: flex; align-items: center; gap: 8px; font-family: 'Outfit', sans-serif; font-size: 1.1rem; color: white;">
                        <span>⚙️</span> E-mailové propojení
                    </h3>
                    <form id="form-email-settings" onsubmit="window.appInstance.saveEmailSettings(event)" style="display: flex; flex-direction: column; gap: 12px; font-size: 0.82rem;">
                        <div>
                            <label style="opacity: 0.8; display: block; margin-bottom: 4px; font-weight: 500;">Váš autorizovaný e-mail (Advokát)</label>
                            <input type="email" id="em-auth-sender" required style="width: 100%; padding: 8px 12px; background: rgba(0,0,0,0.25); border: 1px solid var(--border-glass); border-radius: 6px; color: white; outline: none;" />
                        </div>
                        <div>
                            <label style="opacity: 0.8; display: block; margin-bottom: 4px; font-weight: 500;">Cílová adresa asistentů (filtr)</label>
                            <input type="text" id="em-recip-filter" required style="width: 100%; padding: 8px 12px; background: rgba(0,0,0,0.25); border: 1px solid var(--border-glass); border-radius: 6px; color: white; outline: none;" />
                        </div>
                        
                        <div style="border-top: 1px solid rgba(255,255,255,0.06); padding-top: 10px; margin-top: 5px;">
                            <strong style="color: var(--accent-blue); display: block; margin-bottom: 8px; font-size: 0.8rem;">Příchozí pošta (IMAP)</strong>
                            <div style="display: grid; grid-template-columns: 1.5fr 0.8fr; gap: 10px; margin-bottom: 8px;">
                                <input type="text" id="em-imap-host" placeholder="imap.domain.cz" required style="width: 100%; padding: 8px; background: rgba(0,0,0,0.25); border: 1px solid var(--border-glass); border-radius: 6px; color: white; font-size: 0.8rem;" />
                                <input type="text" id="em-imap-port" placeholder="993" required style="width: 100%; padding: 8px; background: rgba(0,0,0,0.25); border: 1px solid var(--border-glass); border-radius: 6px; color: white; font-size: 0.8rem;" />
                            </div>
                            <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 8px;">
                                <input type="text" id="em-imap-user" placeholder="Uživatel / Login" required style="flex: 1; padding: 8px; background: rgba(0,0,0,0.25); border: 1px solid var(--border-glass); border-radius: 6px; color: white; font-size: 0.8rem;" />
                                <div style="display: flex; align-items: center; gap: 5px; font-size: 0.72rem; white-space: nowrap; color: var(--text-secondary);">
                                    <input type="checkbox" id="em-imap-ssl" /> SSL/TLS
                                </div>
                            </div>
                        </div>

                        <div style="border-top: 1px solid rgba(255,255,255,0.06); padding-top: 10px;">
                            <strong style="color: var(--accent-yellow); display: block; margin-bottom: 8px; font-size: 0.8rem;">Odesílání odpovědí (SMTP)</strong>
                            <div style="display: grid; grid-template-columns: 1.5fr 0.8fr; gap: 10px; margin-bottom: 8px;">
                                <input type="text" id="em-smtp-host" placeholder="smtp.domain.cz" required style="width: 100%; padding: 8px; background: rgba(0,0,0,0.25); border: 1px solid var(--border-glass); border-radius: 6px; color: white; font-size: 0.8rem;" />
                                <input type="text" id="em-smtp-port" placeholder="465" required style="width: 100%; padding: 8px; background: rgba(0,0,0,0.25); border: 1px solid var(--border-glass); border-radius: 6px; color: white; font-size: 0.8rem;" />
                            </div>
                            <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 8px;">
                                <input type="text" id="em-smtp-user" placeholder="Uživatel / Login" required style="flex: 1; padding: 8px; background: rgba(0,0,0,0.25); border: 1px solid var(--border-glass); border-radius: 6px; color: white; font-size: 0.8rem;" />
                                <div style="display: flex; align-items: center; gap: 5px; font-size: 0.72rem; white-space: nowrap; color: var(--text-secondary);">
                                    <input type="checkbox" id="em-smtp-ssl" /> SSL/TLS
                                </div>
                            </div>
                        </div>
                        
                        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 10px;">
                            <button type="submit" class="btn btn-primary" style="width: 100%; justify-content: center; padding: 10px; font-size: 0.82rem; background: var(--accent-blue); border: none; font-weight: 600; color: white;">
                                Uložit nastavení 💾
                            </button>
                            <button type="button" class="btn btn-secondary" onclick="window.appInstance.openEmailSimulationModal()" style="width: 100%; justify-content: center; padding: 10px; font-size: 0.82rem; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.05); color: white;">
                                Simulovat zaslání úkolu 🚀
                            </button>
                        </div>
                    </form>
                </div>

                <!-- Tasks List -->
                <div style="display: flex; flex-direction: column; gap: 15px;">
                    <h3 style="margin-top: 0; margin-bottom: 5px; font-family: 'Outfit', sans-serif; font-size: 1.1rem; color: white;">
                        📥 Úkoly pro asistenty z e-mailu
                    </h3>
                    ${tasksHtml}
                </div>
            </div>
        `;

        // Fill form inputs
        document.getElementById('em-auth-sender').value = s.authorized_sender || '';
        document.getElementById('em-recip-filter').value = s.recipient_filter || '';
        document.getElementById('em-imap-host').value = s.imap_host || '';
        document.getElementById('em-imap-port').value = s.imap_port || '';
        document.getElementById('em-imap-user').value = s.imap_user || '';
        document.getElementById('em-imap-ssl').checked = s.imap_ssl !== false;
        document.getElementById('em-smtp-host').value = s.smtp_host || '';
        document.getElementById('em-smtp-port').value = s.smtp_port || '';
        document.getElementById('em-smtp-user').value = s.smtp_user || '';
        document.getElementById('em-smtp-ssl').checked = s.smtp_ssl !== false;
    }
}

// Bind to window for global inline onclick callbacks
window.addEventListener('DOMContentLoaded', () => {
    window.appInstance = new LexisLocalApp();
    window.appInstance.init();
});
