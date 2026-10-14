const QLEVER = "https://qlever.cs.uni-freiburg.de/api/wikidata";
const P = `PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
`;
const tests = {
  codedNL: `SELECT ?c ?l WHERE { ?c wdt:P297 "NL" . OPTIONAL { ?c rdfs:label ?l FILTER(LANG(?l)="en") } }`,
  rijksCountry: `SELECT ?c ?l WHERE { wd:Q190804 wdt:P17 ?c . OPTIONAL { ?c rdfs:label ?l FILTER(LANG(?l)="en") } }`,
  q55: `SELECT ?p ?o WHERE { wd:Q55 ?p ?o . FILTER(?p IN (wdt:P297, wdt:P361, wdt:P17, wdt:P31)) }`,
  q29999: `SELECT ?p ?o WHERE { wd:Q29999 ?p ?o . FILTER(?p IN (wdt:P297, wdt:P527, wdt:P150, wdt:P31, wdt:P17)) } LIMIT 40`,
};
for (const [name, q] of Object.entries(tests)) {
  const r = await fetch(QLEVER, { method: "POST", headers: { Accept: "application/sparql-results+json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "geo-apps-debug" }, body: new URLSearchParams({ query: P + q }) });
  const t = await r.text();
  let out = t.slice(0, 300);
  try { out = JSON.stringify(JSON.parse(t).results.bindings.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value.replace("http://www.wikidata.org/entity/", "").replace("http://www.wikidata.org/prop/direct/", "")])))); } catch {}
  console.log(`::notice title=${name}::${out.slice(0, 3000).replace(/%/g, "%25")}`);
  await new Promise((s) => setTimeout(s, 1500));
}
