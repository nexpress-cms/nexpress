import { types } from "node:util";
type MetadataOwner = "page" | "forum-public" | "forum-member";
export interface NpSiteBuildBrowserPreviewInputV1 {
  phase: "document" | "interaction";
  themePackage: string;
  origin: string;
  route: string;
  locale: string;
  headerNavigation: "present" | "empty";
  /** Host-observed normal metadata owner expectations; never authored blueprint choices. */
  metadata: {
    owner: MetadataOwner;
    canonicalPath: string;
    descriptionRequired: boolean;
    structuredData: "optional" | "required" | "forbidden";
  };
}
type LocalLink = {
  kind: "local";
  route: string;
  query: boolean;
  fragment: "none" | "present" | "missing" | "unverified";
};
type Link =
  | LocalLink
  | { kind: "external"; origin: string }
  | { kind: "unrequested-scheme" }
  | { kind: "unsupported" };
const accessibilityRules = [
  "lang",
  "image-alt",
  "control-name",
  "link-name",
  "duplicate-id",
] as const;
type AccessibilityRule = (typeof accessibilityRules)[number];
const metadataDiagnostics = [
  "duplicate-title",
  "duplicate-description",
  "duplicate-canonical",
  "duplicate-viewport",
  "head-text-limit",
  "language",
  "canonical-origin",
  "canonical-path",
  "canonical-query",
  "canonical-credentials",
  "canonical-syntax",
  "viewport",
  "structured-data",
  "structured-data-forbidden",
] as const;
const completenessDiagnostics = [
  "element-limit",
  "next-route-announcer-shadow",
  "other-shadow",
  "frame",
  "structured-data-limit",
  "link-limit",
  "report-limit",
] as const;
interface CommonObservation {
  schemaVersion: "np.site-build-browser-preview-observation.v1";
  phase: "document" | "interaction";
  themePackage: string;
  route: string;
  locale: string;
  metadataOwner: MetadataOwner;
  routeMatches: boolean;
}
export type NpSiteBuildBrowserPreviewObservationV1 =
  | (CommonObservation & {
      phase: "document";
      complete: boolean;
      metadata: { missing: boolean; invalid: boolean };
      accessibility: AccessibilityRule[];
      overflow: { root: boolean; controls: boolean };
      links: Link[];
      diagnostics?: {
        metadata: Array<(typeof metadataDiagnostics)[number]>;
        completeness: Array<(typeof completenessDiagnostics)[number]>;
      };
    })
  | (CommonObservation & { phase: "interaction"; supported: boolean; passed: boolean });

/**
 * Fixed isolated-world program. Root owns creation of that world and continuous CDP
 * request auditing. This program neither fetches nor submits/navigates a form/link.
 * Main-world listeners still run for the finite owned UI events: any attempted
 * forbidden request must remain sticky at the outer browser boundary.
 */
export const NP_SITE_BUILD_BROWSER_PREVIEW_CHECKS_SOURCE_V1 = String.raw`(async function(input) {
  const base={schemaVersion:'np.site-build-browser-preview-observation.v1',phase:input.phase,
    themePackage:input.themePackage,route:input.route,locale:input.locale,
    metadataOwner:input.metadata.owner,routeMatches:location.origin===input.origin&&
      decodeURI(location.pathname)===input.route&&!location.search&&!location.hash};
  const canonicalPath=p=>typeof p==='string'&&p.length<=512&&p.startsWith('/')&&!p.startsWith('//')&&
    !/[\\\s?#%\x00-\x1f\x7f]/u.test(p)&&(p==='/'||!p.endsWith('/')&&
    p.slice(1).split('/').every(x=>x&&x!=='.'&&x!=='..')&&
    !['admin','api','_next','.nexpress'].includes(p.split('/')[1]));
  const visible=e=>{for(let p=e;p;p=p.parentElement){const s=getComputedStyle(p);
    if(p.hidden||p.inert||p.getAttribute('aria-hidden')==='true'||s.display==='none'||
      s.visibility==='hidden'||s.visibility==='collapse')return false;}
    return e.getClientRects().length>0;};
  const tick=()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
  if(input.phase==='interaction') {
    const result={...base,supported:true,passed:false};
    const profiles={
      '@nexpress/theme-default':['.np-mobile-nav-toggle','np-mobile-nav-drawer','.np-site-logo'],
      '@nexpress/theme-community':['.np-community-mobile-toggle','np-community-mobile-menu','.np-community-brand'],
      '@nexpress/theme-magazine':['.np-magazine-mobile-nav-toggle','np-magazine-mobile-nav-drawer','a.np-magazine-logo'],
      '@nexpress/theme-portfolio':['.np-portfolio-nav-toggle','np-portfolio-nav-drawer','a.np-portfolio-logo']};
    const previous=document.activeElement, sx=scrollX, sy=scrollY;
    const restore=()=>{if(previous&&previous!==document.body&&previous!==document.documentElement&&
      previous.isConnected&&typeof previous.focus==='function')previous.focus({preventScroll:true});
      else if(document.activeElement&&typeof document.activeElement.blur==='function')document.activeElement.blur();
      scrollTo(sx,sy);};
    const focus=selector=>{const es=document.querySelectorAll(selector);if(es.length!==1||!visible(es[0]))return false;
      es[0].focus({preventScroll:true});return document.activeElement===es[0];};
    try {
      if(input.themePackage==='@nexpress/theme-docs') {
        const target=document.getElementById('np-docs-search-input');
        if(!target||!visible(target)||target.tagName!=='INPUT')return result;
        if(document.activeElement&&typeof document.activeElement.blur==='function')document.activeElement.blur();
        document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true,cancelable:true}));
        await tick();result.passed=document.activeElement===target;return result;
      }
      if(input.themePackage==='@nexpress/theme-storefront') {
        result.passed=focus('a.np-storefront-brand');return result;
      }
      const profile=profiles[input.themePackage];
      if(!profile){result.supported=false;return result;}
      const buttons=document.querySelectorAll(profile[0]);
      if(!buttons.length&&input.headerNavigation==='empty'&&
        ['@nexpress/theme-magazine','@nexpress/theme-portfolio'].includes(input.themePackage)) {
        result.passed=focus(profile[2]);return result;
      }
      if(buttons.length!==1)return result;
      const button=buttons[0];
      if(!visible(button)) {
        // The desktop profile has no menu action. Exercise the source-owned brand focus only.
        result.passed=focus(profile[2]);return result;
      }
      if(button.tagName!=='BUTTON'||button.getAttribute('type')!=='button'||
        button.getAttribute('aria-controls')!==profile[1]||button.getAttribute('aria-expanded')!=='false')return result;
      const ownedStyles=()=>[document.documentElement.style.overflowX,document.documentElement.style.maxWidth,
        document.body.style.overflow,document.body.style.maxWidth];
      const styleBefore=JSON.stringify(ownedStyles());
      let opened=false;
      try {
        button.click();await tick();
        const drawer=document.getElementById(profile[1]);
        opened=button.getAttribute('aria-expanded')==='true'&&!!drawer&&visible(drawer);
      } finally {
        if(button.getAttribute('aria-expanded')==='true'){button.click();await tick();}
      }
      const drawer=document.getElementById(profile[1]);
      result.passed=opened&&button.getAttribute('aria-expanded')==='false'&&(!drawer||!visible(drawer))&&
        JSON.stringify(ownedStyles())===styleBefore;
      return result;
    } finally {restore();}
  }
  const result={...base,complete:true,metadata:{missing:false,invalid:false},accessibility:[],
    overflow:{root:false,controls:false},links:[],diagnostics:{metadata:[],completeness:[]}};
  const invalid=code=>{result.metadata.invalid=true;if(!result.diagnostics.metadata.includes(code))result.diagnostics.metadata.push(code);};
  const incomplete=code=>{result.complete=false;if(!result.diagnostics.completeness.includes(code))result.diagnostics.completeness.push(code);};
  const elements=Array.from(document.querySelectorAll('*'));
  if(elements.length>50000)incomplete('element-limit');
  // Next's installed AppRouterAnnouncer has exactly one noninteractive live
  // region in an open shadow root. Inspect that finite content rather than
  // treating every ordinary Next page as unexamined. Unknown/nested elements,
  // attributes or a changed owner shape remain incomplete.
  const nextAnnouncer=e=>{
    const root=e.shadowRoot;
    if(e.localName!=='next-route-announcer'||root.mode!=='open'||
      e.childNodes.length||root.childNodes.length!==1||
      Array.from(e.attributes).some(a=>a.name!=='style'))return false;
    const node=root.childNodes[0];
    if(node.nodeType!==1||node.tagName!=='DIV'||node.shadowRoot||node.children.length||
      node.getAttribute('id')!=='__next-route-announcer__'||
      node.getAttribute('aria-live')!=='assertive'||node.getAttribute('role')!=='alert'||
      Array.from(node.attributes).some(a=>!['id','aria-live','role','style'].includes(a.name))||
      node.childNodes.length>1||Array.from(node.childNodes).some(n=>n.nodeType!==3)||
      node.textContent.length>600)return false;
    const css=getComputedStyle(node);
    return css.position==='absolute'&&css.width==='1px'&&css.height==='1px'&&
      css.overflow==='hidden'&&css.whiteSpace==='nowrap';
  };
  if(elements.some(e=>e.shadowRoot&&e.localName==='next-route-announcer'&&!nextAnnouncer(e)))incomplete('next-route-announcer-shadow');
  if(elements.some(e=>e.shadowRoot&&e.localName!=='next-route-announcer'))incomplete('other-shadow');
  if(document.querySelector('iframe,frame'))incomplete('frame');
  const list=elements.slice(0,50000),issues=new Set(),ids=new Map();
  for(const e of list){const id=e.getAttribute('id');if(id){if(ids.has(id))issues.add('duplicate-id');ids.set(id,e);}}
  const name=e=>{
    if((e.getAttribute('aria-label')||'').trim())return true;
    const refs=(e.getAttribute('aria-labelledby')||'').trim().split(/\s+/u).filter(Boolean);
    if(refs.length&&refs.every(id=>ids.has(id))&&refs.some(id=>(ids.get(id).textContent||'').trim()))return true;
    if(e.labels&&Array.from(e.labels).some(label=>(label.textContent||'').trim()))return true;
    if(e.tagName==='INPUT'){
      const type=(e.getAttribute('type')||'text').toLowerCase();
      if(['submit','reset'].includes(type))return e.getAttribute('value')===null||!!e.value.trim();
      if(type==='image')return !!(e.getAttribute('alt')||'').trim();
      return type==='button'&&!!e.value.trim();}
    return !!(e.textContent||'').trim()||Array.from(e.querySelectorAll('img[alt]')).some(x=>x.getAttribute('alt').trim());};
  if(document.documentElement.lang!==input.locale)issues.add('lang');
  for(const e of list){if(!visible(e))continue;
    if(e.tagName==='IMG'&&!e.hasAttribute('alt'))issues.add('image-alt');
    if(['INPUT','SELECT','TEXTAREA','BUTTON'].includes(e.tagName)&&e.getAttribute('type')!=='hidden'&&!name(e))issues.add('control-name');
    if(e.tagName==='A'&&e.hasAttribute('href')&&!name(e))issues.add('link-name');
    if(['INPUT','SELECT','TEXTAREA','BUTTON','A'].includes(e.tagName)){
      const r=e.getBoundingClientRect();
      if(r.width>0&&r.height>0&&(r.left< -1||r.right>innerWidth+1)){
        let contained=false;for(let p=e.parentElement;p&&p!==document.body&&p!==document.documentElement;p=p.parentElement){
          const s=getComputedStyle(p),pr=p.getBoundingClientRect();
          if(['auto','scroll'].includes(s.overflowX)&&pr.left>=-1&&pr.right<=innerWidth+1){contained=true;break;}}
        if(!contained)result.overflow.controls=true;}}
  }
  result.accessibility=Array.from(issues).sort();
  result.overflow.root=Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)>innerWidth+1;
  const titles=document.querySelectorAll('title'),descriptions=document.querySelectorAll('meta[name="description"]'),
    canonicals=document.querySelectorAll('link[rel~="canonical"]'),viewports=document.querySelectorAll('meta[name="viewport"]');
  if(!titles.length||!titles[0].textContent.trim()||!canonicals.length||!viewports.length||
    input.metadata.descriptionRequired&&(!descriptions.length||!(descriptions[0].getAttribute('content')||'').trim()))result.metadata.missing=true;
  if(titles.length>1)invalid('duplicate-title');
  if(descriptions.length>1)invalid('duplicate-description');
  if(canonicals.length>1)invalid('duplicate-canonical');
  if(viewports.length>1)invalid('duplicate-viewport');
  if(Array.from(titles).some(e=>e.textContent.length>600)||
    Array.from(descriptions).some(e=>(e.getAttribute('content')||'').length>1000))invalid('head-text-limit');
  if(document.documentElement.lang!==input.locale)invalid('language');
  for(const e of canonicals){try{const u=new URL(e.getAttribute('href'),location.href);
    if(u.origin!==input.origin)invalid('canonical-origin');
    if(decodeURI(u.pathname)!==input.metadata.canonicalPath)invalid('canonical-path');
    if(u.search||u.hash)invalid('canonical-query');
    if(u.username||u.password)invalid('canonical-credentials');
    }catch{invalid('canonical-syntax');}}
  if(viewports.length&&!/width\s*=\s*device-width/u.test(viewports[0].getAttribute('content')||''))invalid('viewport');
  const structured=document.querySelectorAll('script[type="application/ld+json"]');
  if(structured.length>16){incomplete('structured-data-limit');invalid('structured-data');}
  if(input.metadata.structuredData==='required'&&!structured.length)result.metadata.missing=true;
  if(input.metadata.structuredData==='forbidden'&&structured.length)invalid('structured-data-forbidden');
  let structuredBytes=0;
  for(const e of Array.from(structured).slice(0,16)){try{if(e.textContent.length>131072||
      (structuredBytes+=e.textContent.length)>524288)throw new Error();const v=JSON.parse(e.textContent);
    const pending=[{value:v,depth:0}];let count=0;while(pending.length){const item=pending.pop();
      if(++count>10000||item.depth>64)throw new Error();
      if(item.value&&typeof item.value==='object')for(const child of Object.values(item.value))pending.push({value:child,depth:item.depth+1});}
    const rows=Array.isArray(v)?v:[v];if(!rows.length||rows.length>100||rows.some(x=>!x||typeof x!=='object'||
      x['@context']!=='https://schema.org'||!x['@type']&&!Array.isArray(x['@graph'])))invalid('structured-data');
    }catch{invalid('structured-data');}}
  const anchors=document.querySelectorAll('a[href],area[href]');
  if(anchors.length>4096)incomplete('link-limit');
  const seen=new Set();
  for(const e of Array.from(anchors).slice(0,4096)){
    let link={kind:'unsupported'};
    try {const raw=e.getAttribute('href');if(typeof raw!=='string'||raw.length>4096||/[\\\x00-\x1f\x7f]/u.test(raw))throw new Error();
      const u=new URL(raw,location.href);if(u.username||u.password)throw new Error();
      if(u.origin===input.origin){const path=decodeURI(u.pathname);if(!canonicalPath(path))throw new Error();
        let fragment='none';if(u.hash){if(path===input.route&&!u.search){let id;
          try{id=decodeURIComponent(u.hash.slice(1));}catch{throw new Error();}
          fragment=document.getElementById(id)||Array.from(document.getElementsByName(id)).length?'present':'missing';
          }else fragment='unverified';}
        link={kind:'local',route:path,query:!!u.search,fragment};
      }else if(u.protocol==='https:')link={kind:'external',origin:u.origin};
      else if(['mailto:','tel:'].includes(u.protocol))link={kind:'unrequested-scheme'};
    }catch{}
    const key=JSON.stringify(link);if(!seen.has(key)){seen.add(key);result.links.push(link);}
  }
  if(JSON.stringify(result).length>524288){incomplete('report-limit');result.links=[];}
  result.diagnostics.metadata.sort();result.diagnostics.completeness.sort();
  return result;
})`;

const fail = (): never => {
  throw new TypeError("Invalid Build browser preview observation");
};
/** Reject runtime objects before traversing them; never invoke accessors or proxy traps. */
export function detach(value: unknown): unknown {
  let nodes = 0;
  const seen = new WeakSet<object>();
  const visit = (v: unknown, depth: number): unknown => {
    if (++nodes > 30000 || depth > 8) return fail();
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "string") {
      if (
        v.length > 4096 ||
        Array.from(v).some((c) => {
          const point = c.codePointAt(0) ?? 0;
          return point < 32 || point === 127 || (point >= 0xd800 && point <= 0xdfff);
        })
      )
        return fail();
      return v;
    }
    if (typeof v === "number") return Number.isSafeInteger(v) ? v : fail();
    if (typeof v !== "object" || types.isProxy(v) || seen.has(v)) return fail();
    seen.add(v);
    if (Array.isArray(v)) {
      if (Object.getPrototypeOf(v) !== Array.prototype || v.length > 4096) return fail();
      if (Reflect.ownKeys(v).length !== v.length + 1) return fail();
      return Array.from({ length: v.length }, (_, i) => {
        const d = Object.getOwnPropertyDescriptor(v, String(i));
        return d?.enumerable && "value" in d ? visit(d.value, depth + 1) : fail();
      });
    }
    const proto: unknown = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return fail();
    const out: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(v)) {
      if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key))
        return fail();
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (!d?.enumerable || !("value" in d)) return fail();
      out[key] = visit(d.value, depth + 1);
    }
    return out;
  };
  const result = visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024) return fail();
  return result;
}
export function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== keys.length || keys.some((key) => !Object.hasOwn(data, key)))
    return fail();
  return data;
}
const bool = (v: unknown): boolean => (typeof v === "boolean" ? v : fail());
export const one = <T extends string>(v: unknown, values: readonly T[]): T =>
  typeof v === "string" && values.includes(v as T) ? (v as T) : fail();
export function path(v: unknown): string {
  if (typeof v !== "string" || v.length > 512 || !v.startsWith("/") || /[\\\s?#%]/u.test(v))
    return fail();
  if (
    v.startsWith("//") ||
    (v !== "/" &&
      (v.endsWith("/") ||
        v
          .slice(1)
          .split("/")
          .some((p) => !p || p === "." || p === ".."))) ||
    ["admin", "api", "_next", ".nexpress"].includes(v.split("/")[1])
  )
    return fail();
  return v;
}
export function locale(v: unknown): string {
  if (typeof v !== "string" || v.length > 35) return fail();
  try {
    return Intl.getCanonicalLocales(v)[0] === v ? v : fail();
  } catch {
    return fail();
  }
}
function theme(v: unknown): string {
  return typeof v === "string" && /^@nexpress\/theme-[a-z0-9-]{1,64}$/u.test(v) ? v : fail();
}
const metadataOwner = (v: unknown): MetadataOwner =>
  one(v, ["page", "forum-public", "forum-member"]);
function origin(v: unknown, local: boolean): string {
  if (typeof v !== "string" || v.length > 2048) return fail();
  try {
    const u = new URL(v);
    if (u.origin !== v || u.username || u.password) return fail();
    return local
      ? u.protocol === "http:" && u.hostname === "127.0.0.1" && u.port
        ? v
        : fail()
      : u.protocol === "https:"
        ? v
        : fail();
  } catch {
    return fail();
  }
}
export function createSiteBuildBrowserPreviewProgramV1(value: unknown): string {
  const d = fields(detach(value), [
    "phase",
    "themePackage",
    "origin",
    "route",
    "locale",
    "headerNavigation",
    "metadata",
  ]);
  const m = fields(d.metadata, ["owner", "canonicalPath", "descriptionRequired", "structuredData"]);
  const input: NpSiteBuildBrowserPreviewInputV1 = {
    phase: one(d.phase, ["document", "interaction"]),
    themePackage: theme(d.themePackage),
    origin: origin(d.origin, true),
    route: path(d.route),
    locale: locale(d.locale),
    headerNavigation: one(d.headerNavigation, ["present", "empty"]),
    metadata: {
      owner: metadataOwner(m.owner),
      canonicalPath: path(m.canonicalPath),
      descriptionRequired: bool(m.descriptionRequired),
      structuredData: one(m.structuredData, ["optional", "required", "forbidden"]),
    },
  };
  if (input.metadata.owner === "forum-member" && input.metadata.structuredData !== "forbidden")
    return fail();
  return `${NP_SITE_BUILD_BROWSER_PREVIEW_CHECKS_SOURCE_V1}(${JSON.stringify(input)})`;
}

export function requireSiteBuildBrowserPreviewObservationV1(
  value: unknown,
): NpSiteBuildBrowserPreviewObservationV1 {
  const data = detach(value);
  const phase =
    data && typeof data === "object" && !Array.isArray(data) ? Reflect.get(data, "phase") : fail();
  const common = [
    "schemaVersion",
    "phase",
    "themePackage",
    "route",
    "locale",
    "metadataOwner",
    "routeMatches",
  ];
  const d = fields(data, [
    ...common,
    ...(phase === "document"
      ? ["complete", "metadata", "accessibility", "overflow", "links"]
      : ["supported", "passed"]),
    ...(phase === "document" &&
    data &&
    typeof data === "object" &&
    Object.hasOwn(data, "diagnostics")
      ? ["diagnostics"]
      : []),
  ]);
  if (d.schemaVersion !== "np.site-build-browser-preview-observation.v1") return fail();
  const base = {
    schemaVersion: d.schemaVersion,
    themePackage: theme(d.themePackage),
    route: path(d.route),
    locale: locale(d.locale),
    metadataOwner: metadataOwner(d.metadataOwner),
    routeMatches: bool(d.routeMatches),
  } as const;
  if (phase === "interaction")
    return { ...base, phase, supported: bool(d.supported), passed: bool(d.passed) };
  if (phase !== "document") return fail();
  const m = fields(d.metadata, ["missing", "invalid"]),
    o = fields(d.overflow, ["root", "controls"]);
  if (!Array.isArray(d.accessibility) || d.accessibility.length > 5 || !Array.isArray(d.links))
    return fail();
  const accessibility = d.accessibility.map((v) => one(v, accessibilityRules));
  if (new Set(accessibility).size !== accessibility.length) return fail();
  const links: Link[] = d.links.map((value) => {
    const e =
      value && typeof value === "object" && !Array.isArray(value)
        ? Reflect.get(value, "kind")
        : fail();
    if (e === "local") {
      const v = fields(value, ["kind", "route", "query", "fragment"]);
      return {
        kind: e,
        route: path(v.route),
        query: bool(v.query),
        fragment: one(v.fragment, ["none", "present", "missing", "unverified"]),
      };
    }
    if (e === "external") {
      const v = fields(value, ["kind", "origin"]);
      return { kind: e, origin: origin(v.origin, false) };
    }
    fields(value, ["kind"]);
    return { kind: one(e, ["unsupported", "unrequested-scheme"]) };
  });
  if (new Set(links.map((l) => JSON.stringify(l))).size !== links.length) return fail();
  let diagnostics: Extract<
    NpSiteBuildBrowserPreviewObservationV1,
    { phase: "document" }
  >["diagnostics"];
  if (Object.hasOwn(d, "diagnostics")) {
    const value = fields(d.diagnostics, ["metadata", "completeness"]);
    const codes = <T extends string>(input: unknown, allowed: readonly T[]): T[] => {
      if (!Array.isArray(input) || input.length > allowed.length) return fail();
      const parsed = input.map((code) => one(code, allowed));
      if (parsed.some((code, i) => i > 0 && parsed[i - 1] >= code)) return fail();
      return parsed;
    };
    diagnostics = {
      metadata: codes(value.metadata, metadataDiagnostics),
      completeness: codes(value.completeness, completenessDiagnostics),
    };
    if (
      (diagnostics.metadata.length && !m.invalid) ||
      (diagnostics.completeness.length && d.complete)
    )
      return fail();
  }
  return {
    ...base,
    phase,
    complete: bool(d.complete),
    metadata: { missing: bool(m.missing), invalid: bool(m.invalid) },
    accessibility,
    overflow: { root: bool(o.root), controls: bool(o.controls) },
    links,
    ...(diagnostics ? { diagnostics } : {}),
  };
}
