// app-agents.js — část dashboardu vytažená z app.js (prototype-mixin, beze změny chování).
// Načítá se v index.html PO app.js. Metody se přidávají na LexisLocalApp.prototype.
Object.assign(LexisLocalApp.prototype, {

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
    },

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
    },

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
    },

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
        document.getElementById('agent-form-spis-access').value = agent.spisAccess || ((agent.permissions && agent.permissions.read_files) ? 'full' : 'none');
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
    },

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
        document.getElementById('agent-form-spis-access').value = 'none';
        document.getElementById('agent-form-perm-registries').checked = false;
        document.getElementById('agent-form-perm-desktop').checked = false;

        // Actions
        const btnReset = document.getElementById('btn-reset-agent');
        const btnDelete = document.getElementById('btn-delete-agent');
        if (btnReset) btnReset.style.display = 'none';
        if (btnDelete) btnDelete.style.display = 'none';
    },

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
        const spisAccess = document.getElementById('agent-form-spis-access').value; const readFiles = spisAccess !== 'none';
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
                spisAccess,
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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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

});
