/**
 * LexisLocal Green AI Resource Monitor
 * Evaluates energy consumption and CO2 emissions of local LLM runs.
 * Promotes Green AI standards (EU Green Deal alignment).
 */

const os = require('os');

// Reference carbon intensity: EU average is ~400 g CO2 / kWh (0.4 g CO2 / Wh)
const EU_GRID_CARBON_INTENSITY = 0.4; 

// Reference average Cloud LLM energy per query (including datacenters, WAN, cooling): ~2.5 Wh / request
const AVERAGE_CLOUD_QUERY_ENERGY_WH = 2.5; 

/**
 * Returns hardware signature and estimated TDP (Thermal Design Power) in Watts
 * for local inference profiling.
 */
function getHardwareProfile() {
    const platform = os.platform();
    const arch = os.arch();
    const cpusCount = os.cpus().length;
    
    let hardwareName = `${platform} (${arch}, ${cpusCount} CPUs)`;
    let estimatedTdp = 45; // Default generic CPU TDP in Watts

    if (platform === 'darwin') {
        hardwareName = `Apple Silicon (${arch})`;
        estimatedTdp = 20; // Highly efficient Apple Silicon M-series typically draws ~15-25W under LLM load
    } else if (platform === 'win32' || platform === 'linux') {
        // Generic estimate: assumes typical desktop CPU or standard GPU helper
        estimatedTdp = 65; 
    }

    return {
        hardwareName,
        estimatedTdp
    };
}

/**
 * Calculates power draw, energy usage, and CO2 emissions for a local inference run.
 * @param {number} durationMs - Inference duration in milliseconds
 * @returns {object} - Carbon and energy metrics
 */
function calculateInferenceMetrics(durationMs) {
    const durationSec = durationMs / 1000;
    const profile = getHardwareProfile();
    
    // Wh = Watts * hours
    const energyWh = profile.estimatedTdp * (durationSec / 3600);
    const co2Grams = energyWh * EU_GRID_CARBON_INTENSITY;
    
    // Cloud query carbon footprint estimation
    const cloudCo2Grams = AVERAGE_CLOUD_QUERY_ENERGY_WH * EU_GRID_CARBON_INTENSITY;
    
    // Compute local savings/efficiency index
    const carbonSavedGrams = Math.max(0, cloudCo2Grams - co2Grams);
    const co2SavingPercent = cloudCo2Grams > 0 ? (carbonSavedGrams / cloudCo2Grams) * 100 : 0;

    return {
        hardware: profile.hardwareName,
        tdpWatts: profile.estimatedTdp,
        durationSeconds: parseFloat(durationSec.toFixed(2)),
        energyWh: parseFloat(energyWh.toFixed(5)),
        co2Grams: parseFloat(co2Grams.toFixed(5)),
        cloudEquivalentWh: AVERAGE_CLOUD_QUERY_ENERGY_WH,
        cloudCo2Grams: parseFloat(cloudCo2Grams.toFixed(2)),
        carbonSavedGrams: parseFloat(carbonSavedGrams.toFixed(5)),
        co2SavingPercent: parseFloat(co2SavingPercent.toFixed(1))
    };
}

/**
 * Gathers system hardware performance telemetry (RAM, load, simulated VRAM).
 */
function getSystemTelemetry() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const cpuLoad = os.loadavg();
    const uptime = os.uptime();
    
    const profile = getHardwareProfile();
    let estimatedVramTotalGb = 0;
    let estimatedVramFreeGb = 0;
    
    if (profile.hardwareName.includes('Apple Silicon')) {
        estimatedVramTotalGb = parseFloat((totalMem / (1024 * 1024 * 1024) * 0.5).toFixed(1));
        estimatedVramFreeGb = parseFloat((freeMem / (1024 * 1024 * 1024) * 0.5).toFixed(1));
    } else {
        const sysGb = totalMem / (1024 * 1024 * 1024);
        estimatedVramTotalGb = sysGb > 16 ? 8 : 4;
        estimatedVramFreeGb = parseFloat((estimatedVramTotalGb * (freeMem / totalMem)).toFixed(1));
    }
    
    return {
        platform: os.platform(),
        arch: os.arch(),
        uptimeSeconds: uptime,
        cpuCores: os.cpus().length,
        systemLoad: parseFloat(cpuLoad[0].toFixed(2)),
        memoryTotalGb: parseFloat((totalMem / (1024 * 1024 * 1024)).toFixed(2)),
        memoryUsedGb: parseFloat((usedMem / (1024 * 1024 * 1024)).toFixed(2)),
        memoryFreeGb: parseFloat((freeMem / (1024 * 1024 * 1024)).toFixed(2)),
        vramTotalGb: estimatedVramTotalGb,
        vramFreeGb: estimatedVramFreeGb,
        timestamp: new Date().toISOString()
    };
}

module.exports = {
    getHardwareProfile,
    calculateInferenceMetrics,
    getSystemTelemetry,
    AVERAGE_CLOUD_QUERY_ENERGY_WH,
    EU_GRID_CARBON_INTENSITY
};
