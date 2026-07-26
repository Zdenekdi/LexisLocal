/**
 * LexisLocal Dashboard Application Controller
 * Handles tabs navigation, status checking, Ollama model manager, RAG inbox, and Agent Chat.
 */

document.addEventListener('DOMContentLoaded', () => {
    const app = new LexisLocalApp();
    app.init();
    window.appInstance = app;
});

// escapeHtml je vytažen do app-helpers.js (načítá se před app.js) — jeden zdroj pravdy.

class LexisLocalApp {
    constructor() {
        // Dynamically adjust API base to current location host (Tailscale / remote IP / VPN)
        const origin = window.location.origin;
        this.apiBase = origin.startsWith('file://') || origin.includes('null') ? 'http://localhost:4000/api' : `${origin}/api`;
        this.activeTab = 'overview';
        this.models = [];
        this.inbox = [];
        this.watcherActive = true;
        this.apiToken = (typeof window !== 'undefined' && window.LEXIS_API_TOKEN) || localStorage.getItem('lexis_api_token') || '';
        
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
        const swarmOrchestrateToggle = document.getElementById('toggle-swarm-orchestrate');
        
        if (swarmToggle) {
            swarmToggle.addEventListener('change', (e) => {
                const agent1Container = document.getElementById('config-agent-1-container');
                const agent2Container = document.getElementById('config-agent-2-container');
                const lblAgent1 = document.getElementById('lbl-agent-1');
                
                if (e.target.checked) {
                    if (swarmOrchestrateToggle) {
                        swarmOrchestrateToggle.checked = false;
                    }
                    if (agent1Container) agent1Container.style.display = 'block';
                    if (agent2Container) agent2Container.style.display = 'block';
                    if (lblAgent1) lblAgent1.textContent = 'Aktivní AI Asistent / Tvůrce:';
                } else {
                    if (agent2Container) agent2Container.style.display = 'none';
                    if (lblAgent1) lblAgent1.textContent = 'Aktivní AI Asistent:';
                }
            });
        }

        if (swarmOrchestrateToggle) {
            swarmOrchestrateToggle.addEventListener('change', (e) => {
                const agent1Container = document.getElementById('config-agent-1-container');
                const agent2Container = document.getElementById('config-agent-2-container');
                
                if (e.target.checked) {
                    if (swarmToggle) {
                        swarmToggle.checked = false;
                    }
                    if (agent1Container) agent1Container.style.display = 'none';
                    if (agent2Container) agent2Container.style.display = 'none';
                } else {
                    if (agent1Container) agent1Container.style.display = 'block';
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

        // Verify Ledger Action
        const verifyLedgerBtn = document.getElementById('btn-verify-ledger');
        if (verifyLedgerBtn) {
            verifyLedgerBtn.addEventListener('click', () => this.verifyTransparencyLedger());
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











































    // --- WORKFLOW TAB INTEGRATIONS ---














    // --- TIME-TRACKING TAB INTEGRATIONS ---





    // --- RISKS & COMPLIANCE TAB INTEGRATIONS ---





    // --- MANAGERIAL INTELLIGENCE TAB INTEGRATIONS ---















    // ─── E-mailové úkoly a AI Asistenti ──────────────────────────────────────────────











}

// Bind to window for global inline onclick callbacks
window.addEventListener('DOMContentLoaded', () => {
    window.appInstance = new LexisLocalApp();
    window.appInstance.init();
});
