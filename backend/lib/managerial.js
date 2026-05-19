/**
 * LexisLocal Managerial Intelligence & Profitability Module (Fáze 4)
 * Analyzes case timesheet profitability against budgets and tracks capacity allocation
 * for lawyers and assistants based on pending deadlines.
 */

const db = require('./database');

class ManagerialIntelligence {
    constructor() {
        this.initDefaultBudgets();
    }

    /**
     * Seeds initial budgets for demonstration and backward compatibility
     */
    initDefaultBudgets() {
        const existing = db.get('budgets');
        if (existing.length === 0) {
            db.insert('budgets', {
                documentName: "Nájemní smlouva.docx",
                budgetType: "hourly_cap",
                limitHours: 10,
                hourlyRate: 2500
            });
            db.insert('budgets', {
                documentName: "Odvolání proti rozsudku.docx",
                budgetType: "flat",
                limitHours: 5,
                hourlyRate: 3000
            });
        }
    }

    /**
     * Gets the office default hourly rate from database settings
     */
    getDefaultHourlyRate() {
        const settings = db.get('settings');
        const rateSetting = settings.find(s => s.key === 'default_hourly_rate');
        return rateSetting ? parseFloat(rateSetting.value) : 2500;
    }

    /**
     * Returns office managerial settings
     */
    getOfficeSettings() {
        return {
            defaultHourlyRate: this.getDefaultHourlyRate()
        };
    }

    /**
     * Updates office managerial settings
     */
    updateOfficeSettings(settingsData) {
        const rate = parseFloat(settingsData.defaultHourlyRate);
        if (isNaN(rate) || rate <= 0) {
            throw new Error("Neplatná výše hodinové sazby.");
        }

        const settings = db.get('settings');
        const existing = settings.find(s => s.key === 'default_hourly_rate');

        if (existing) {
            db.update('settings', existing.id, { value: rate.toString() });
        } else {
            db.insert('settings', { key: 'default_hourly_rate', value: rate.toString() });
        }

        return { defaultHourlyRate: rate };
    }

    /**
     * Returns a profitability report for all monitored documents/cases
     */
    getProfitabilityReport() {
        const budgets = db.get('budgets');
        const activities = db.get('activities');
        const defaultRate = this.getDefaultHourlyRate();

        // Aggregate actual time spent per document
        const timeSpent = {};
        activities.forEach(act => {
            const doc = act.documentName;
            if (!timeSpent[doc]) {
                timeSpent[doc] = 0;
            }
            timeSpent[doc] += act.activeSeconds || 30;
        });

        const report = budgets.map(budget => {
            const actualSeconds = timeSpent[budget.documentName] || 0;
            const actualHours = parseFloat((actualSeconds / 3600).toFixed(2));
            const limitHours = budget.limitHours || 10;
            const spentPercentage = parseFloat(((actualHours / limitHours) * 100).toFixed(1));

            let status = 'profitable';
            if (spentPercentage > 100) {
                status = 'unprofitable';
            } else if (spentPercentage > 80) {
                status = 'warning';
            }

            const currentRate = budget.hourlyRate || defaultRate;
            const estimatedCost = actualHours * currentRate;

            return {
                id: budget.id,
                documentName: budget.documentName,
                budgetType: budget.budgetType,
                limitHours,
                actualHours,
                spentPercentage,
                hourlyRate: currentRate,
                estimatedCost,
                status
            };
        });

        // Add any tracked documents that don't have an explicit budget set
        Object.entries(timeSpent).forEach(([docName, seconds]) => {
            const hasBudget = budgets.some(b => b.documentName === docName);
            if (!hasBudget) {
                const actualHours = parseFloat((seconds / 3600).toFixed(2));
                report.push({
                    documentName: docName,
                    budgetType: "unassigned",
                    limitHours: 0,
                    actualHours,
                    spentPercentage: 0,
                    hourlyRate: defaultRate,
                    estimatedCost: actualHours * defaultRate,
                    status: 'profitable'
                });
            }
        });

        return report;
    }

    /**
     * Set or edit a custom case/document budget
     */
    setBudget(budgetData) {
        const existing = db.get('budgets').find(b => b.documentName === budgetData.documentName);
        const defaultRate = this.getDefaultHourlyRate();
        const rate = parseFloat(budgetData.hourlyRate) || defaultRate;
        
        if (existing) {
            return db.update('budgets', existing.id, {
                budgetType: budgetData.budgetType || existing.budgetType,
                limitHours: parseFloat(budgetData.limitHours) || existing.limitHours,
                hourlyRate: parseFloat(budgetData.hourlyRate) || existing.hourlyRate || defaultRate
            });
        }

        return db.insert('budgets', {
            documentName: budgetData.documentName,
            budgetType: budgetData.budgetType || "hourly_cap",
            limitHours: parseFloat(budgetData.limitHours) || 8,
            hourlyRate: rate
        });
    }

    /**
     * Computes capacity allocation and team load indicators based on pending tasks (alerts)
     */
    getCapacityAllocation() {
        const alerts = db.get('alerts').filter(a => a.status === 'pending');
        
        const staff = [
            { id: "advokat", name: "JUDr. Zdeněk Dias (Advokát)", role: "Partner", load: 0, status: "optimal" },
            { id: "koncipient_a", name: "Mgr. Jan Novák (Koncipient A)", role: "Koncipient", load: 0, status: "optimal" },
            { id: "koncipient_b", name: "Mgr. Eva Sladká (Koncipient B)", role: "Koncipient", load: 0, status: "optimal" }
        ];

        // Intelligently allocate tasks based on keywords in alerts
        alerts.forEach(alert => {
            const titleLower = alert.title.toLowerCase();
            
            if (titleLower.includes('odvolání') || titleLower.includes('rozsudek')) {
                staff[0].load += 1.5; // Advokát reviews court orders
            } else if (titleLower.includes('smlouva') || titleLower.includes('lustrace')) {
                staff[1].load += 1.0; // Koncipient A drafts contracts
            } else {
                staff[2].load += 0.8; // Koncipient B reviews AML and others
            }
        });

        // Determine load status levels
        const updatedStaff = staff.map(member => {
            let status = 'optimal';
            if (member.load > 3.0) {
                status = 'overloaded';
            } else if (member.load < 1.0) {
                status = 'underloaded';
            }
            return {
                ...member,
                status
            };
        });

        return {
            staff: updatedStaff,
            totalAlertsCount: alerts.length,
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = new ManagerialIntelligence();
