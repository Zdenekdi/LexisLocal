/**
 * Testy fyzické spisové struktury a BEZPEČNÉHO směrování zápisu (lib/spisFolders.js).
 *
 * Klíčové vlastnosti pod ochranou:
 *  • každý spis má vlastní složku s číslovanými podsložkami + strojovou vizitkou,
 *  • koncept se uloží do 03_Koncepty SPRÁVNÉHO spisu (podle spisId z vizitky),
 *  • FAIL-CLOSED: neznámý/nejednoznačný spis → _Nezařazeno, nikdy do cizí složky,
 *  • žádná záměna klientů (podání spisu A nikdy neskončí u spisu B).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const tmp = path.join(os.tmpdir(), `lexis_test_spisFolders_${Date.now()}`);
fs.mkdirSync(tmp, { recursive: true });
process.env.WATCH_DIR = tmp;          // INGEST_DIR se odvodí odtud
process.env.LEXIS_KEY_DIR = tmp + '_key';

const sf = require('../lib/spisFolders');

const spisA = { id: 'spis_A', spisZn: '15 C 123/2026', klient: 'Jan Novák', protistrana: 'ČSOB a.s.' };
const spisB = { id: 'spis_B', spisZn: '8 As 9/2026', klient: 'Marie Dvořáková', protistrana: 'Finanční úřad' };

describe('spisFolders — struktura a vizitka', () => {
    test('ensureSpisFolder založí složku, podsložky i vizitku', () => {
        const r = sf.ensureSpisFolder(spisA);
        expect(r.created).toBe(true);
        expect(fs.existsSync(r.folderPath)).toBe(true);
        sf.SUBFOLDERS.forEach(subf => {
            expect(fs.existsSync(path.join(r.folderPath, subf))).toBe(true);
        });
        const marker = sf.readMarker(r.folderPath);
        expect(marker).not.toBeNull();
        expect(marker.spisId).toBe('spis_A');
        expect(marker.spisZn).toBe('15 C 123/2026');
    });

    test('folderId má formát RRRR-NNNN a inkrementuje se', () => {
        const rb = sf.ensureSpisFolder(spisB);
        expect(rb.folderId).toMatch(/^\d{4}-\d{4}$/);
        // spisA byl první → 0001, spisB druhý → 0002
        expect(rb.folderId.endsWith('0002')).toBe(true);
    });

    test('ensureSpisFolder je idempotentní (stejná cesta, created=false)', () => {
        const r1 = sf.ensureSpisFolder(spisA);
        const r2 = sf.ensureSpisFolder(spisA);
        expect(r1.folderPath).toBe(r2.folderPath);
        expect(r2.created).toBe(false);
    });

    test('findFolderBySpisId najde složku podle spisId', () => {
        const f = sf.findFolderBySpisId('spis_A');
        expect(f).not.toBeNull();
        expect(f.folderPath).toContain('2026-0001');
    });

    test('_slug odstraní znaky zakázané v názvech souborů', () => {
        expect(sf._slug('a/b\\c:d*e?f"g<h>i|j')).not.toMatch(/[\/\\:*?"<>|]/);
        expect(sf._slug('   ..tečka..  ')).not.toMatch(/^[._]/);
    });
});

describe('spisFolders — bezpečné směrování zápisu', () => {
    test('koncept se uloží do 03_Koncepty správného spisu', () => {
        const d = sf.saveDraftToSpis({ spisId: 'spis_A', fileName: 'zaloba.docx', content: 'obsah A' });
        expect(d.filed).toBe(true);
        const folderA0 = sf.findFolderBySpisId('spis_A').folderPath;
        expect(d.savedPath.startsWith(path.join(folderA0, '03_Koncepty'))).toBe(true);
        expect(d.folderId).toBe('2026-0001');
        expect(fs.readFileSync(d.savedPath, 'utf8')).toBe('obsah A');
    });

    test('FAIL-CLOSED: neznámý spis jde do _Nezařazeno, ne do cizí složky', () => {
        const d = sf.saveDraftToSpis({ spisId: 'spis_NEEXISTUJE', fileName: 'podani.docx', content: 'x' });
        expect(d.filed).toBe(false);
        expect(d.reason).toBe('no-folder');
        expect(d.savedPath).toContain(sf.NEZARAZENO);
    });

    test('žádná záměna klientů: koncept spisu A není ve složce spisu B', () => {
        const fA = sf.findFolderBySpisId('spis_A').folderPath;
        const fB = sf.findFolderBySpisId('spis_B').folderPath;
        const koncB = fs.readdirSync(path.join(fB, '03_Koncepty'));
        expect(koncB.length).toBe(0);
        const koncA = fs.readdirSync(path.join(fA, '03_Koncepty'));
        expect(koncA).toContain('zaloba.docx');
    });

    test('nedestruktivní: druhý koncept stejného jména nepřepíše první', () => {
        sf.saveDraftToSpis({ spisId: 'spis_A', fileName: 'unik.docx', content: 'prvni' });
        const d2 = sf.saveDraftToSpis({ spisId: 'spis_A', fileName: 'unik.docx', content: 'druhy' });
        const dir = path.join(sf.findFolderBySpisId('spis_A').folderPath, '03_Koncepty');
        const uniky = fs.readdirSync(dir).filter(n => n.startsWith('unik'));
        expect(uniky.length).toBe(2);
    });

    test('složka bez platné vizitky se nebere jako spis (fail-closed)', () => {
        // ruční složka bez .lexisspis.json
        fs.mkdirSync(path.join(tmp, 'rucni_slozka_bez_vizitky'), { recursive: true });
        const f = sf.findFolderBySpisId('cokoliv');
        expect(f).toBeNull();
    });
});
