/* Balcony garden, plant inventory. The one place plants are defined.
   Both the page and the Worker read this file, so keep it valid JSON inside the
   backticks: double quotes, no trailing commas, no comments inside the block.

   - bump "version" on every change so the app merges it in
   - "area" is "balcony" (glazed balcony, feels the forecast) or "indoor" (heated
     room, does not). Move a plant indoors for winter by editing its area here.
   - add "water": "YYYY-MM-DD" to a plant to record "watered on that day"
   - add "started": "YYYY-MM-DD" for the day this plant's season began. The
     season bar then starts there, with a marker and a first band up to growing
   - add "startedHow" alongside it: "sown", "planted", "bought" or "cutting".
     It is how the bar names that date ("Sown 12 Apr"). Leave both out when
     the date is not known: the bar never guesses one
   - PLACEHOLDERS: every "started" date below is a stand-in picked on
     2026-09-30 so the bar has something to show. Replace them with the real
     dates, then bump "version"
*/
window.GARDEN_SEED = JSON.parse(`{
  "version": 13,
  "plants": [
    { "id": "tomato-1", "started": "2026-03-20", "startedHow": "sown", "name": "Tigerella tomato", "species": "tomato", "stage": "flowering", "area": "balcony",
      "note": "Striped, indeterminate, stake + pinch side shoots. Ripe when stripes turn orange-red. Tolerates cool summers." },
    { "id": "tomato-2", "started": "2026-03-20", "startedHow": "sown", "name": "Noire de Crimée tomato", "species": "tomato", "stage": "flowering", "area": "balcony",
      "note": "Black beefsteak, tall, feed generously. Ripe when SOFT, not by colour (stays dark brown-red)." },
    { "id": "rasp-maurin", "started": "2026-06-10", "startedHow": "bought", "name": "Maurin Makea raspberry", "species": "raspberry", "stage": "fruiting", "area": "balcony",
      "note": "Finnish summer raspberry, very sweet berries. Frost-hardy, overwinters on the balcony." },
    { "id": "rasp-takala-1", "started": "2026-07-18", "startedHow": "bought", "name": "Takalan Herkku raspberry 1", "species": "raspberry", "stage": "settling", "area": "balcony",
      "note": "New pot · hardy Finnish summer raspberry. First-year canes, main crop next summer." },
    { "id": "rasp-takala-2", "started": "2026-07-18", "startedHow": "bought", "name": "Takalan Herkku raspberry 2", "species": "raspberry", "stage": "settling", "area": "balcony",
      "note": "New pot · hardy Finnish summer raspberry. First-year canes, main crop next summer." },
    { "id": "parsley-1", "started": "2026-04-20", "startedHow": "sown", "name": "Parsley 1", "species": "parsley", "stage": "growing", "area": "balcony" },
    { "id": "parsley-2", "started": "2026-04-20", "startedHow": "sown", "name": "Parsley 2", "species": "parsley", "stage": "growing", "area": "balcony" },
    { "id": "chilli-1", "started": "2026-07-05", "startedHow": "sown", "name": "Lombardo chilli 1", "species": "chilli", "stage": "seedling", "area": "balcony",
      "note": "Mild Italian frying chilli (Biltema)" },
    { "id": "chilli-2", "started": "2026-07-05", "startedHow": "sown", "name": "Lombardo chilli 2", "species": "chilli", "stage": "seedling", "area": "balcony",
      "note": "Mild Italian frying chilli (Biltema)" },
    { "id": "basil-1", "started": "2026-05-10", "startedHow": "sown", "name": "Basil 1", "species": "basil", "stage": "growing", "area": "balcony",
      "note": "Italiano Classico (Biltema)" },
    { "id": "basil-2", "started": "2026-05-10", "startedHow": "sown", "name": "Basil 2", "species": "basil", "stage": "growing", "area": "balcony",
      "note": "Italiano Classico (Biltema)" },
    { "id": "mint", "started": "2026-06-01", "startedHow": "cutting", "name": "Mint", "species": "mint", "stage": "growing", "area": "balcony",
      "note": "Bought as a plant, not from seed. Own pot, or it takes over" },
    { "id": "monstera", "started": "2026-09-20", "startedHow": "bought", "name": "Monstera", "species": "monstera", "stage": "settling", "area": "indoor",
      "note": "IKEA · bright indirect spot, away from radiators" },
    { "id": "hedera", "started": "2026-09-15", "startedHow": "bought", "name": "Ivy (Hedera helix)", "species": "hedera", "stage": "settling", "area": "indoor",
      "note": "IKEA · came in from the balcony, shade-tolerant" }
  ]
}`);
