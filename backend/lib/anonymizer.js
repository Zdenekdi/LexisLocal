/**
 * LexisLocal GDPR Sovereign Data Shield
 * Provides local-first, zero-dependency Czech PII anonymizer.
 * Redacts names, birth numbers (rodná čísla), e-mails, and phone numbers.
 */

const fs = require('fs');
const path = require('path');

const CZECH_GIVEN_NAMES = new Set([
    'jan', 'jana', 'petr', 'jiri', 'jiří', 'marie', 'josef', 'pavel', 'martin', 'tomas', 'tomáš',
    'jaroslav', 'miroslav', 'frantisek', 'františek', 'vaclav', 'václav', 'michal', 'zdenek', 'zdeněk',
    'jakub', 'lenka', 'katerina', 'kateřina', 'alena', 'hana', 'ludmila', 'david', 'filip',
    'lukas', 'lukáš', 'ondrej', 'ondřej', 'veronika', 'monika', 'kristyna', 'kristýna', 'barbora'
]);

/**
 * Anonymizes PII (Personally Identifiable Information) in a Czech legal text.
 * @param {string} text - Raw input text
 * @returns {string} - Pseudonymized text
 */
function anonymizeText(text) {
    if (!text) return text;
    
    let result = text;
    
    // 1. Anonymize Emails
    result = result.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[E-MAIL]');
    
    // 2. Anonymize Czech Birth Numbers (rodná čísla: e.g. 850708/1234 or 901231/123)
    result = result.replace(/\b\d{6}\/\d{3,4}\b/g, '[RODNÉ ČÍSLO]');
    
    // 3. Anonymize Czech Phone Numbers (+420 123 456 789, 777123456, etc.)
    result = result.replace(/(?:\+(?:420|421)\s*)?[1-9]\d{2}\s*\d{3}\s*\d{3}\b/g, '[TELEFON]');
    
    // 4. Anonymize Czech Academics/Titles + Name patterns (e.g. Mgr. Novák, JUDr. Petr Novotný)
    const titleRegex = /\b(?:Mgr|Ing|JUDr|PhDr|MUDr|doc|prof|Bc)\.?\s+[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]+(?:\s+[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]+)?/g;
    result = result.replace(titleRegex, '[JMÉNO A TITUL]');
    
    // 5. Anonymize Common Czech Name + Surname combinations
    const words = result.split(/(\s+)/);
    for (let i = 0; i < words.length - 2; i += 2) {
        const currentWord = words[i].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (CZECH_GIVEN_NAMES.has(currentWord)) {
            const nextWord = words[i + 2];
            if (nextWord && /^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/.test(nextWord)) {
                words[i] = '[JMÉNO]';
                words[i + 2] = '[PŘÍJMENÍ]';
            }
        }
    }
    result = words.join('');
    
    // Clean up consecutive placeholders
    result = result.replace(/\[JMÉNO\]\s*\[PŘÍJMENÍ\]/g, '[JMÉNO A PŘÍJMENÍ]');
    result = result.replace(/\[JMÉNO\]\s*\[JMÉNO\]/g, '[JMÉNO]');
    
    return result;
}

module.exports = {
    anonymizeText,
    CZECH_GIVEN_NAMES
};
