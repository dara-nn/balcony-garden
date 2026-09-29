/* Pure rules shared by the page, the Worker and the tests.
   An ES module so all three can load it without a build step.

   Plants on the glazed balcony feel the forecast; plants indoors do not. */

const isOutdoors = (p) => (p.area || 'balcony') === 'balcony';

/* The model summarises a plant's health in its own words. Only the colour is
   constrained: `tone` picks the pill, `label` is whatever fits the plant.
   Reads written before that change carry `overall` from a fixed list instead. */
const TONE_OF = { thriving: 'good', steady: 'watch', struggling: 'bad' };
export function normalizeHealth(h) {
  if (!h) return null;
  const label = h.label || h.overall;
  if (!label) return null;
  const tone = ['good', 'watch', 'bad'].includes(h.tone) ? h.tone : (TONE_OF[h.overall] || 'watch');
  return { label, tone, issues: h.issues || [] };
}

export function weatherAlerts(date, wx, plants) {
  if (!wx) return [];
  const outdoor = plants.filter(isOutdoors);
  if (!outdoor.length) return [];
  const names = outdoor.map((p) => p.name);
  const out = [];
  if (wx.tmin <= 10)
    out.push({
      cat: 'alert', ico: '❄️', key: 'cold|' + date, plants: names,
      what: `Cold night ~${Math.round(wx.tmin)}°, close the glazing`,
      why: 'Tomato fruit-set stalls near 10°C; chilli sprouts sulk under 12°C. Tuck tender pots against the house wall.',
    });
  if (wx.tmax >= 27)
    out.push({
      cat: 'alert', ico: '🔥', key: 'heat|' + date, plants: names,
      what: `${Math.round(wx.tmax)}°, vent by noon`,
      why: 'Glazed balcony bakes. Shade parsley + chilli sprouts; tomato pollen dies over ~32°C.',
    });
  return out;
}
