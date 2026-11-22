import { describe, it, expect } from 'vitest';
import { descriptionImages, imageToken, insertAtCaret, removeDescriptionImage, splitDescription, stripDescriptionImages } from '../taskImages';

describe('task description images', () => {
  it('splits text and app images in order', () => {
    expect(splitDescription('Before\n![wiring](/api/files/12)\nAfter')).toEqual([
      { kind: 'text', text: 'Before\n' },
      { kind: 'image', alt: 'wiring', url: '/api/files/12' },
      { kind: 'text', text: '\nAfter' },
    ]);
  });

  it('leaves outside image links as text', () => {
    const s = '![x](https://evil.example/pixel.png) and ![y](/api/files/abc)';
    expect(descriptionImages(s)).toEqual([]);
    expect(splitDescription(s)).toEqual([{ kind: 'text', text: s }]);
  });

  it('strips tokens for one-line previews', () => {
    expect(stripDescriptionImages('Fix the arm\n![a](/api/files/1)\n\n\n![b](/api/files/2)\nthen test')).toBe('Fix the arm\n\nthen test');
  });

  it('builds a token whose alt cannot break out', () => {
    expect(imageToken('shot [1].png', '/api/files/3')).toBe('![shot  1](/api/files/3)');
    expect(imageToken('', '/api/files/3')).toBe('![image](/api/files/3)');
  });

  it('inserts at the caret on a line of its own', () => {
    expect(insertAtCaret('ab', 1, 1, 'T')).toEqual({ text: 'a\nT\nb', caret: 4 });
    expect(insertAtCaret('', 0, 0, 'T')).toEqual({ text: 'T\n', caret: 2 });
    expect(insertAtCaret('a\n', 2, 2, 'T')).toEqual({ text: 'a\nT\n', caret: 4 });
  });

  it('removes one image and the line it was alone on', () => {
    expect(removeDescriptionImage('a\n![x](/api/files/1)\nb', '/api/files/1')).toBe('a\nb');
    expect(removeDescriptionImage('see ![x](/api/files/1) here', '/api/files/1')).toBe('see  here');
    // /api/files/1 must not match /api/files/12
    expect(removeDescriptionImage('![x](/api/files/12)', '/api/files/1')).toBe('![x](/api/files/12)');
  });
});
