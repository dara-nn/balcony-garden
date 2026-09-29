/* Balcony garden — plant inventory. The one place plants are defined.
   Both the page and the Worker read this file, so keep it valid JSON inside the
   backticks: double quotes, no trailing commas, no comments inside the block.

   - bump "version" on every change so the app merges it in
   - "area" is "balcony" (glazed balcony, feels the forecast) or "indoor" (heated
     room, does not). Move a plant indoors for winter by editing its area here.
   - "resetTasksOn": set to today's date to clear the backlog — every plant then
     counts as watered today and nothing shows overdue
   - add "water": "YYYY-MM-DD" to a plant to record "watered on that day"
*/
window.GARDEN_SEED = JSON.parse(`{
  "version": 8,
  "resetTasksOn": "2026-07-21",
  "plants": [
    { "id": "tomato-1", "name": "Tigerella tomato", "species": "tomato", "stage": "flowering", "area": "balcony",
      "note": "Striped, indeterminate — stake + pinch side shoots. Ripe when stripes turn orange-red. Tolerates cool summers." },
    { "id": "tomato-2", "name": "Noire de Crimée tomato", "species": "tomato", "stage": "flowering", "area": "balcony",
      "note": "Black beefsteak, tall — feed generously. Ripe when SOFT, not by colour (stays dark brown-red)." },
    { "id": "rasp-maurin", "name": "Maurin Makea raspberry", "species": "raspberry", "stage": "fruiting", "area": "balcony",
      "note": "Finnish summer raspberry, very sweet berries. Frost-hardy, overwinters on the balcony." },
    { "id": "rasp-takala-1", "name": "Takalan Herkku raspberry 1", "species": "raspberry", "stage": "settling", "area": "balcony",
      "note": "New pot · hardy Finnish summer raspberry. First-year canes — main crop next summer." },
    { "id": "rasp-takala-2", "name": "Takalan Herkku raspberry 2", "species": "raspberry", "stage": "settling", "area": "balcony",
      "note": "New pot · hardy Finnish summer raspberry. First-year canes — main crop next summer." },
    { "id": "parsley", "name": "Parsley bed", "species": "parsley", "stage": "growing", "area": "balcony" },
    { "id": "chilli-1", "name": "Lombardo chilli 1", "species": "chilli", "stage": "seedling", "area": "balcony",
      "note": "Mild Italian frying chilli (Biltema)" },
    { "id": "chilli-2", "name": "Lombardo chilli 2", "species": "chilli", "stage": "seedling", "area": "balcony",
      "note": "Mild Italian frying chilli (Biltema)" },
    { "id": "basil-mint", "name": "Basil & Mint bed", "species": "basilmint", "stage": "growing", "area": "balcony",
      "note": "Basil: Italiano Classico (Biltema). Shared bed — keep mint from taking over" },
    { "id": "chives", "name": "Chive bed", "species": "chives", "stage": "growing", "area": "balcony" },
    { "id": "spring-onion", "name": "Spring onion bed", "species": "springonion", "stage": "growing", "area": "balcony" },
    { "id": "garlic", "name": "Garlic pot", "species": "garlic", "stage": "bulbing", "area": "balcony" },
    { "id": "monstera", "name": "Monstera", "species": "monstera", "stage": "settling", "area": "indoor",
      "note": "IKEA · bright indirect spot, away from radiators" },
    { "id": "hedera", "name": "Ivy (Hedera helix)", "species": "hedera", "stage": "settling", "area": "balcony",
      "note": "IKEA · balcony, shade-tolerant, frost-hardy" }
  ]
}`);
