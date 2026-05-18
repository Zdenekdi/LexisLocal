/**
 * LexisLocal Workflow Engine Module (Bod 13)
 * Implements an event-driven workflow engine that automatically creates calendar
 * alerts and procedural deadlines based on system events.
 */

const db = require('./database');

class WorkflowEngine {
    constructor() {
        this.initDefaults();
    }

    /**
     * Seed default workflow rules to guarantee 100% backward/forward compliance
     */
    initDefaults() {
        const existingRules = db.get('workflows');
        if (existingRules.length === 0) {
            db.insert('workflows', {
                name: "Hlídání lhůt z datových zpráv",
                triggerType: "isds_received",
                conditionField: "subject",
                conditionValue: "rozsudek",
                actionType: "create_alert",
                actionTitle: "Připravit odvolání (lhůta 15 dní)",
                isSystem: true
            });
            
            db.insert('workflows', {
                name: "Insolvenční lustrace smluv",
                triggerType: "document_saved",
                conditionField: "documentName",
                conditionValue: "smlouva",
                actionType: "create_alert",
                actionTitle: "Prověřit smluvní stranu v registru ISIR",
                isSystem: true
            });
            
            db.insert('workflows', {
                name: "AML audit schůzek",
                triggerType: "document_saved",
                conditionField: "documentName",
                conditionValue: "dohoda",
                actionType: "create_alert",
                actionTitle: "Vypracovat AML KYC dotazník a zapsat identifikaci",
                isSystem: true
            });
        }
    }

    /**
     * Evaluates a triggered system event against defined recipes
     * @param {string} triggerType - 'isds_received' | 'document_saved' | 'registry_alert'
     * @param {Object} payload - Contextual properties to evaluate (e.g. { subject: '...', content: '...' })
     */
    async triggerEvent(triggerType, payload) {
        console.log(`⚡ Workflow Engine: Zpracovávám událost [${triggerType}]...`);
        const rules = db.get('workflows');
        const activeRules = rules.filter(r => r.triggerType === triggerType);
        const createdAlerts = [];

        for (const rule of activeRules) {
            let isMatched = false;

            if (rule.conditionField && rule.conditionValue) {
                const fieldValue = payload[rule.conditionField];
                if (fieldValue && typeof fieldValue === 'string') {
                    isMatched = fieldValue.toLowerCase().includes(rule.conditionValue.toLowerCase());
                }
            } else {
                isMatched = true; // Match-all trigger
            }

            if (isMatched) {
                console.log(`⚡ Workflow Engine: Aktivováno pravidlo "${rule.name}"`);
                
                // Calculate calendar deadline (+15 days default for procedural steps)
                const deadline = new Date();
                deadline.setDate(deadline.getDate() + 15);

                const alert = db.insert('alerts', {
                    title: rule.actionTitle,
                    triggerRule: rule.name,
                    status: 'pending',
                    deadline: deadline.toISOString(),
                    payloadDetails: JSON.stringify(payload)
                });

                createdAlerts.push(alert);
            }
        }

        return createdAlerts;
    }

    /**
     * CRUD Rules
     */
    getRules() {
        return db.get('workflows');
    }

    addRule(ruleData) {
        return db.insert('workflows', {
            name: ruleData.name || "Nové pravidlo",
            triggerType: ruleData.triggerType || "document_saved",
            conditionField: ruleData.conditionField || "",
            conditionValue: ruleData.conditionValue || "",
            actionType: ruleData.actionType || "create_alert",
            actionTitle: ruleData.actionTitle || "Nová procesní lhůta",
            isSystem: false
        });
    }

    deleteRule(id) {
        const rules = db.get('workflows');
        const rule = rules.find(r => r.id === id);
        if (rule && rule.isSystem) {
            throw new Error("Systémová pravidla nelze smazat.");
        }
        return db.delete('workflows', id);
    }
}

module.exports = new WorkflowEngine();
