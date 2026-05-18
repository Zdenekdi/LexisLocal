/**
 * LexisLocal Dashboard Application Controller
 * Handles tabs navigation, status checking, Ollama model manager, RAG inbox, and Agent Chat.
 */

document.addEventListener('DOMContentLoaded', () => {
    const app = new LexisLocalApp();
    app.init();
    window.appInstance = app;
});

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
        await this.loadInbox();
        await this.loadAlerts();
        
        // Periodically refresh stats and inbox
        setInterval(() => this.checkSystemStatus(), 10000);
        setInterval(() => this.checkRagStatus(), 10000);
        setInterval(() => this.loadInbox(), 8000);
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
                title: "Agent Playground",
                sub: "Otestujte chování specializovaných boti swarmu v reálném čase."
            },
            manual: {
                title: "Nápověda & Nastavení",
                sub: "Kompletní návod na konfiguraci lokální AI a chování swarmu."
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
                this.renderAgentsList(data.activeAgents);
            }
        } catch (e) {
            console.warn("Chyba při komunikaci se serverem status:", e);
        }
    }

    renderAgentsList(agentIds) {
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
                            
                            <button class="btn btn-secondary" onclick="window.appInstance.analyzeEntireCase('${caseNum.replace(/'/g, "\\'")}')" style="margin-top: 12px; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 0.78rem; padding: 8px 12px;">
                                🤖 Zanalyzovat kompletní podklady spisu (${files.length} dok.)
                            </button>
                        </div>
                    </div>
                    <div class="inbox-deadline" style="width: 180px; display: flex; flex-direction: column; align-items: flex-end; justify-content: flex-start; text-align: right; flex-shrink: 0; border-left: 1px solid var(--border-glass); padding-left: 20px;">
                        ${deadlineHtml}
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
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
                    <p>${userText}</p>
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
                        <p style="color:var(--accent-red);">Chyba spojení s lokálním serverem: ${e.message}</p>
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
            resultsEl.innerHTML = `<div class="no-results" style="color: var(--accent-red); border-color: rgba(239, 68, 68, 0.2);">❌ Chyba sémantického vyhledávání: ${e.message}</div>`;
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
}

// Bind to window for global inline onclick callbacks
window.addEventListener('DOMContentLoaded', () => {
    window.appInstance = new LexisLocalApp();
    window.appInstance.init();
});
