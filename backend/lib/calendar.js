const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Helper to escape quotes in AppleScript strings
 */
function escapeAppleScriptString(str) {
    if (!str) return '';
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Helper to format a Date for AppleScript
 * Generates lines to construct an AppleScript date object
 */
function generateAppleScriptDate(dateVarName, dateObj) {
    const year = dateObj.getFullYear();
    const month = dateObj.getMonth() + 1; // 1-12
    const day = dateObj.getDate();
    const hours = dateObj.getHours();
    const minutes = dateObj.getMinutes();
    const seconds = dateObj.getSeconds();
    
    return `
set ${dateVarName} to (current date)
set day of ${dateVarName} to 1
set year of ${dateVarName} to ${year}
set monthNames to {January, February, March, April, May, June, July, August, September, October, November, December}
set month of ${dateVarName} to item ${month} of monthNames
set day of ${dateVarName} to ${day}
set time of ${dateVarName} to (${hours} * 3600 + ${minutes} * 60 + ${seconds})
    `.trim();
}

/**
 * Sync event to macOS Apple Calendar
 */
function syncMacCalendar({ title, startDate, endDate, description, location }) {
    return new Promise((resolve, reject) => {
        const escTitle = escapeAppleScriptString(title);
        const escDesc = escapeAppleScriptString(description || '');
        const escLoc = escapeAppleScriptString(location || '');
        
        const startScript = generateAppleScriptDate('startDate', startDate);
        const endScript = generateAppleScriptDate('endDate', endDate);
        
        const appleScript = `
${startScript}
${endScript}

tell application "Calendar"
    set calName to "LexisLocal"
    if not (exists calendar calName) then
        create calendar with name calName
    end if
    set targetCal to calendar calName
    
    set matchedEvents to (events of targetCal whose summary is "${escTitle}")
    set duplicateFound to false
    repeat with ev in matchedEvents
        if (start date of ev) is equal to startDate then
            set duplicateFound to true
            exit repeat
        end if
    end repeat
    
    if not duplicateFound then
        make new event at end of events of targetCal with properties {summary:"${escTitle}", start date:startDate, end date:endDate, description:"${escDesc}", location:"${escLoc}"}
        return "created"
    else
        return "duplicate"
    end if
end tell
        `;
        
        const proc = exec('osascript', (error, stdout, stderr) => {
            if (error) {
                console.error("❌ AppleScript Error:", stderr);
                return reject(error);
            }
            const result = stdout.trim();
            resolve(result);
        });
        
        proc.stdin.write(appleScript);
        proc.stdin.end();
    });
}

/**
 * Sync event to Windows MS Outlook
 */
function syncWinCalendar({ title, startDate, endDate, description, location }) {
    return new Promise((resolve, reject) => {
        // Format dates as local strings that PowerShell / COM can parse
        // e.g. "2026-06-02 14:00:00"
        const formatForPS = (d) => {
            const pad = (n) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        };
        
        const psStart = formatForPS(startDate);
        const psEnd = formatForPS(endDate);
        const escTitle = (title || '').replace(/'/g, "''");
        const escDesc = (description || '').replace(/'/g, "''");
        const escLoc = (location || '').replace(/'/g, "''");
        
        // PowerShell script using Outlook COM object
        const psScript = `
$outlook = New-Object -ComObject Outlook.Application
$namespace = $outlook.GetNameSpace("MAPI")
$calendar = $namespace.GetDefaultFolder(9) # olFolderCalendar

$subj = '${escTitle}'
$start = [DateTime]::Parse('${psStart}')
$end = [DateTime]::Parse('${psEnd}')

# Query events matching Subject and Start time
$filter = "[Subject] = '$subj'"
$items = $calendar.Items.Restrict($filter)
$duplicate = $false

foreach ($item in $items) {
    if ($item.Start -eq $start) {
        $duplicate = $true
        break
    }
}

if (-not $duplicate) {
    $event = $outlook.CreateItem(1) # olAppointmentItem
    $event.Subject = $subj
    $event.Start = $start
    $event.End = $end
    $event.Body = '${escDesc}'
    $event.Location = '${escLoc}'
    $event.Save()
    Write-Output "created"
} else {
    Write-Output "duplicate"
}
        `;
        
        // Execute Powershell script
        const proc = exec('powershell -Command -', (error, stdout, stderr) => {
            if (error) {
                console.error("❌ PowerShell Error:", stderr);
                return reject(error);
            }
            resolve(stdout.trim());
        });
        
        proc.stdin.write(psScript);
        proc.stdin.end();
    });
}

/**
 * Core entry point for writing events to the system calendar
 * Supports Apple Calendar on macOS (darwin) and Outlook on Windows (win32)
 */
async function writeToSystemCalendar({ title, date, time, location, description }) {
    const platform = process.platform;
    
    // Parse Dates
    let startDate, endDate;
    if (!date) {
        throw new Error("Date is required.");
    }
    
    if (time) {
        const [h, m] = time.split(':');
        startDate = new Date(`${date}T${h}:${m}:00`);
        // Default appointment duration is 1 hour
        endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
    } else {
        // All-day event
        startDate = new Date(`${date}T09:00:00`);
        endDate = new Date(`${date}T10:00:00`);
    }
    
    console.log(`📅 Pokus o zápis do systémového kalendáře (${platform}): "${title}" dne ${date} v ${time || 'celý den'}`);
    
    if (platform === 'darwin') {
        return await syncMacCalendar({ title, startDate, endDate, description, location });
    } else if (platform === 'win32') {
        return await syncWinCalendar({ title, startDate, endDate, description, location });
    } else {
        console.warn(`⚠️ Platforma ${platform} nepodporuje přímý zápis do nativního kalendáře.`);
        return 'unsupported_platform';
    }
}

module.exports = {
    writeToSystemCalendar
};
