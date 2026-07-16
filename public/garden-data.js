/* Balcony garden — plant inventory.
   Edited via chat with Claude: bump `version` on every change so the app merges it in. */
window.GARDEN_SEED = {
  version: 7,
  resetTasksOn: '2026-07-21',   // bump to today's date to clear the backlog: every plant counts as watered today, nothing overdue
  plants: [
    // add `water:'YYYY-MM-DD'` to a plant to record "watered on that day" — applies on the next version bump
    { id:'tomato-1',     name:'Tigerella tomato', species:'tomato',    stage:'flowering',
      note:'Striped, indeterminate — stake + pinch side shoots. Ripe when stripes turn orange-red. Tolerates cool summers.' },
    { id:'tomato-2',     name:'Noire de Crimée tomato', species:'tomato', stage:'flowering',
      note:'Black beefsteak, tall — feed generously. Ripe when SOFT, not by colour (stays dark brown-red).' },
    { id:'rasp-maurin',  name:'Maurin Makea raspberry', species:'raspberry', stage:'fruiting',
      note:'Finnish summer raspberry, very sweet berries. Green fruits set now (Jul 2026) — even water while they swell, ripe red over the coming weeks. Frost-hardy, overwinters on the balcony.' },
    { id:'rasp-takala-1', name:'Takalan Herkku raspberry 1', species:'raspberry', stage:'settling',
      note:'New pot · Hardy Finnish summer raspberry, large sweet berries. First-year canes — main crop next summer. Overwinters on the balcony.' },
    { id:'rasp-takala-2', name:'Takalan Herkku raspberry 2', species:'raspberry', stage:'settling',
      note:'New pot · Hardy Finnish summer raspberry, large sweet berries. First-year canes — main crop next summer. Overwinters on the balcony.' },
    { id:'parsley',      name:'Parsley bed',      species:'parsley',   stage:'growing' },
    { id:'chilli-1',     name:'Lombardo chilli 1', species:'chilli',   stage:'seedling',
      note:'Mild Italian frying chilli (Biltema)' },
    { id:'chilli-2',     name:'Lombardo chilli 2', species:'chilli',   stage:'seedling',
      note:'Mild Italian frying chilli (Biltema)' },
    { id:'basil-mint',   name:'Basil & Mint bed', species:'basilmint', stage:'growing',
      note:'Basil: Italiano Classico (Biltema). Shared bed — keep mint from taking over' },
    { id:'chives',       name:'Chive bed',        species:'chives',    stage:'growing' },
    { id:'spring-onion', name:'Spring onion bed', species:'springonion', stage:'growing' },
    { id:'garlic',       name:'Garlic pot',       species:'garlic',    stage:'bulbing' },
    { id:'monstera',     name:'Monstera',         species:'monstera',  stage:'settling',
      note:'IKEA · indoors, bright indirect spot' },
    { id:'hedera',       name:'Ivy (Hedera helix)', species:'hedera',  stage:'settling',
      note:'IKEA · balcony, shade-tolerant, frost-hardy' }
  ]
};
