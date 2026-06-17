const { cosineSimilarity } = require('../lib/rag');

describe('cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
        const vecA = [1, 2, 3];
        const vecB = [1, 2, 3];
        expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(1);
    });

    it('should return 0 for orthogonal vectors', () => {
        const vecA = [1, 0, 0];
        const vecB = [0, 1, 0];
        expect(cosineSimilarity(vecA, vecB)).toBe(0);
    });

    it('should return -1 for opposite vectors', () => {
        const vecA = [1, 2, 3];
        const vecB = [-1, -2, -3];
        expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(-1);
    });

    it('should return 0 if either vector is null or undefined', () => {
        expect(cosineSimilarity(null, [1, 2, 3])).toBe(0);
        expect(cosineSimilarity([1, 2, 3], undefined)).toBe(0);
        expect(cosineSimilarity(null, null)).toBe(0);
    });

    it('should return 0 if vectors have different lengths', () => {
        const vecA = [1, 2, 3];
        const vecB = [1, 2];
        expect(cosineSimilarity(vecA, vecB)).toBe(0);
    });

    it('should return 0 if either vector has a magnitude of 0', () => {
        const vecA = [0, 0, 0];
        const vecB = [1, 2, 3];
        expect(cosineSimilarity(vecA, vecB)).toBe(0);
    });

    it('should calculate the correct similarity for arbitrary vectors', () => {
        const vecA = [1, 2, 3];
        const vecB = [4, 5, 6];
        // dot product = 1*4 + 2*5 + 3*6 = 32
        // normA = sqrt(1^2 + 2^2 + 3^2) = sqrt(14)
        // normB = sqrt(4^2 + 5^2 + 6^2) = sqrt(77)
        const expectedSimilarity = 32 / (Math.sqrt(14) * Math.sqrt(77));
        expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(expectedSimilarity);
    });
});
