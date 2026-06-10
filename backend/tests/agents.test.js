const fs = require('fs');
const path = require('path');
const os = require('os');

// Setup temporary environment variables BEFORE loading the agents module
const tempWatchDir = path.join(os.tmpdir(), `lexis_test_agents_${Date.now()}`);
process.env.WATCH_DIR = tempWatchDir;

const agentsModule = require('../lib/agents');

describe('Agents Utility', () => {
    beforeAll(() => {
        if (!fs.existsSync(tempWatchDir)) {
            fs.mkdirSync(tempWatchDir, { recursive: true });
        }
    });

    afterAll(() => {
        if (fs.existsSync(tempWatchDir)) {
            fs.rmSync(tempWatchDir, { recursive: true, force: true });
        }
    });

    afterEach(() => {
        // Clean up agents file to ensure isolation
        const agentsFile = path.join(tempWatchDir, '.agents.json');
        if (fs.existsSync(agentsFile)) {
            fs.unlinkSync(agentsFile);
        }
    });

    it('should load default agents if file does not exist', () => {
        const loadedAgents = agentsModule.loadAgents();
        expect(loadedAgents).toBeDefined();
        expect(loadedAgents.resersnik).toBeDefined();
        expect(loadedAgents.resersnik.isSystem).toBe(true);
        expect(loadedAgents.kontrolor).toBeDefined();
    });

    it('should save a new custom agent', () => {
        const newAgentData = {
            name: "Test Agent",
            role: "Testing things",
            systemPrompt: "You are a tester."
        };
        const savedAgent = agentsModule.saveAgent('test_agent', newAgentData);

        expect(savedAgent.id).toBe('test_agent');
        expect(savedAgent.name).toBe('Test Agent');
        expect(savedAgent.isSystem).toBe(false);

        const loadedAgents = agentsModule.loadAgents();
        expect(loadedAgents.test_agent).toBeDefined();
        expect(loadedAgents.test_agent.name).toBe('Test Agent');
    });

    it('should update an existing custom agent', () => {
        agentsModule.saveAgent('custom_agent', { name: "Custom 1" });
        const updated = agentsModule.saveAgent('custom_agent', { name: "Custom Updated" });

        expect(updated.name).toBe("Custom Updated");
        const loaded = agentsModule.loadAgents();
        expect(loaded.custom_agent.name).toBe("Custom Updated");
    });

    it('should not allow deleting a system agent', () => {
        agentsModule.loadAgents(); // Initialize file
        expect(() => {
            agentsModule.deleteAgent('resersnik');
        }).toThrow("Systémové agenty nelze smazat.");
    });

    it('should delete a custom agent', () => {
        agentsModule.saveAgent('to_delete', { name: "Delete me" });
        expect(agentsModule.loadAgents().to_delete).toBeDefined();

        const result = agentsModule.deleteAgent('to_delete');
        expect(result).toBe(true);
        expect(agentsModule.loadAgents().to_delete).toBeUndefined();
    });

    it('should reset a system agent to default', () => {
        agentsModule.loadAgents(); // Initialize defaults

        // Modify system agent
        agentsModule.saveAgent('stylista', { name: "Modified Stylista" });
        expect(agentsModule.loadAgents().stylista.name).toBe("Modified Stylista");

        // Reset
        const resetAgent = agentsModule.resetAgentToDefault('stylista');
        expect(resetAgent.name).toBe("Stylista");
        expect(agentsModule.loadAgents().stylista.name).toBe("Stylista");
    });
});
