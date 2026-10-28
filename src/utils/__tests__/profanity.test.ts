// Swear words in member text are hidden; ordinary words that contain one are not.
import { describe, it, expect } from 'vitest';
import { censorParts, hasProfanity, maskProfanity } from '../profanity';

describe('profanity', () => {
  it.each([
    'what the fuck', 'FUCKING robot', 'motherfucker', 'f*ck this', 'fuuuck', 'wtf',
    'this is shit!', 'sh1t', '$hit', 'bullshit', 'you bitch', 'b1tch',
    'what an ass', 'asshole', 'dumbass', 'bastard', 'dickhead', 'piss off', 'slut',
    '**fuck**', 'retarded',
  ])('hides %j', (text) => {
    expect(hasProfanity(text)).toBe(true);
  });

  it.each([
    'class', 'assess the intake', 'passion', 'Scunthorpe', 'cocktail', 'shiitake', 'Hancock',
    'Dickens', 'assist', 'Nigeria', 'flame retardant', 'spice', 'bass', 'grass', 'shift', 'fork',
    'hello', 'damn', 'what the heck', 'button', 'therapist', 'cockpit',
  ])('leaves %j alone', (text) => {
    expect(hasProfanity(text)).toBe(false);
  });

  it('splits text into plain runs and hidden words, in order', () => {
    expect(censorParts('ok shit, ok')).toEqual([
      { text: 'ok ', hidden: false }, { text: 'shit', hidden: true }, { text: ', ok', hidden: false },
    ]);
    expect(censorParts('nothing here')).toEqual([{ text: 'nothing here', hidden: false }]);
  });

  it('masks for copying', () => {
    expect(maskProfanity('oh shit no')).toBe('oh •••• no');
  });
});
