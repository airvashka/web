# Directus schéma — collections k vytvoření

Tato složka **dokumentuje** datový model.
Po nasazení Directus na Railway si v admin UI **klikneme** jednotlivé collections podle těchto JSON souborů.

## Pořadí vytváření

1. `01-brands.json` — značky (KGM, OMODA & JAECOO, Farizon)
2. `02-sub-brands.json` — podznačky (OMODA, JAECOO pod brand OMODA & JAECOO)
3. `03-branches.json` — pobočky (zatím Praha-Ďáblice)
4. `04-employees.json` — pracovníci (z vizitek)
5. `05-models.json` — modely (16 modelů)
6. `06-model-years.json` — modelové roky
7. `07-trim-levels.json` — výbavové úrovně (Style, Style+, Premium…)
8. `08-option-packages.json` — packety (TECH, BLACK, PREMIUM+…)
9. `09-stock-vehicles.json` — skladové vozy
10. `10-leads.json` — poptávky z formulářů
11. `11-pages.json` — CMS-managed stránky
12. `12-blog-posts.json` — blog

## Klíčové vztahy

- `models.brand_id` → brands
- `models.sub_brand_id` → sub_brands (nullable)
- `model_years.model_id` → models
- `trim_levels.model_year_id` → model_years
- `option_packages.model_year_id` → model_years
- `stock_vehicles.{brand,model,model_year,trim_level}_id` → příslušné
- `leads.source_{model,vehicle}_id` → modely / skladové vozy

## Klíčové principy

1. **Snapshot pattern u skladových vozů.** Při vytvoření vozu se uloží snapshot
   trim levelu + packetů jako JSON. Pozdější změny číselníků starý vůz neovlivní.

2. **Verzování trim levelů a packetů.** Directus má built-in `revisions`. Každá
   editace = nová revize, lze se vrátit.

3. **Lokalizace zatím vypnutá.** Začneme jen cs_CZ. Až bude potřeba SK/EN,
   zapneme `translations` extension.

## Importovat / vytvořit ručně

Pro DEN 1 si tyto collections vytvořím ručně v Directus admin (5-10 min na collection).
Pro budoucí teamy můžeme exportovat snapshot přes Directus CLI:

```bash
npx directus schema snapshot ./snapshot.yaml
```

a importovat ho:

```bash
npx directus schema apply ./snapshot.yaml
```
