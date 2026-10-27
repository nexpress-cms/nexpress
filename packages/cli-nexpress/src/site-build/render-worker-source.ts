/** Fixed host worker, loaded from the private project by the shipped restricted TS loader. */
export const NP_SITE_BUILD_RENDER_WORKER_SOURCE_V1 = String.raw`
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const project = '/np/project';
const output = '/np/output';
let stage = 'input';
try {
const input = JSON.parse(await readFile(join(project,'.nexpress/site/tmp/render-input.json'),'utf8'));
// Capture the fixed driver environment before any project module is evaluated.
const doctorEnvironment=input.mode==='doctor'?Object.freeze({...process.env}):null;
const require = createRequire(join(project,'package.json'));
const owner = async (name) => import(pathToFileURL(require.resolve(name)).href);
const contract = await owner('@nexpress/core/agent-contract');
const collectDoctorChecks = input.mode==='doctor'
  ? (await owner('@nexpress/app/scripts/doctor-core')).collectDoctorChecks : null;
const buildDoctorJson = input.mode==='doctor'
  ? (await owner('@nexpress/app/scripts/doctor-output')).buildDoctorJson : null;
const candidateOwner = input.mode==='blueprint'||input.mode==='candidate'
  ? await owner('@nexpress/app/lib/site-build-candidate') : null;
if(candidateOwner)stage = 'candidate-owners';
// Capture package-owned callbacks/components before project config can mutate them.
const candidateCapture = candidateOwner
  ? await candidateOwner.npCaptureDefaultBuildCandidateOwnersV1(input.renderer) : null;
stage = 'config-import';
const config = (await import(pathToFileURL(join(project,input.config)).href)).default;
const defaults = await owner('@nexpress/app/config-defaults');
const catalogOwner = await owner('@nexpress/app/lib/site-build-catalog');
if (input.mode === 'catalog') {
  stage = 'catalog';
  const result = await catalogOwner.npCollectConfiguredBuildCatalogV1(config,input.renderer,defaults.npGetDefaultBuildOwnerBindingsV1());
  await writeFile(join(output,'catalog.json'),JSON.stringify(result.catalog),{flag:'wx',mode:0o600});
} else if(input.mode==='blueprint') {
  stage = 'blueprint';
  const blueprintOwner=await owner('@nexpress/app/lib/site-build-blueprint');
  const validated=await blueprintOwner.npValidateConfiguredBuildBlueprintV1(config,input.renderer,
    defaults.npGetDefaultBuildOwnerBindingsV1(),input.brief,input.directions,input.blueprint);
  await writeFile(join(output,'blueprint.json'),JSON.stringify(validated.blueprint),{flag:'wx',mode:0o600});
  await writeFile(join(output,'blueprint-report.json'),JSON.stringify({scope:validated.scope,
    blueprintHash:validated.blueprintHash,discoveryFingerprint:validated.fingerprint,
    expectedCollectionDefinitions:validated.expectedCollectionDefinitions}),{flag:'wx',mode:0o600});
  stage='candidate-baseline';
  const baseline=await candidateOwner.npObserveConfiguredBuildCandidateBaselineV1({
    capture:candidateCapture,config,validation:validated});
  await writeFile(join(output,'candidate-baseline.json'),JSON.stringify(baseline),{flag:'wx',mode:0o600});
  stage='repository-seed';
  const seedOwner=await owner('@nexpress/app/lib/site-build-seed');
  const selected=input.directions.directions.find(direction=>direction.id===validated.blueprint.selectedDirectionId);
  const selectedTheme=validated.catalog.themes.find(theme=>theme.package===selected.themeBase);
  if(!selectedTheme)throw new Error('Selected theme unavailable');
  const repositorySeed=seedOwner.npCreateSiteBuildSeedArtifactV1(validated.blueprint,
    {id:selectedTheme.id,package:selectedTheme.package});
  await writeFile(join(output,'repository-seed.json'),seedOwner.npSerializeSiteBuildSeedArtifactV1(repositorySeed),{flag:'wx',mode:0o600});
} else if(input.mode==='candidate') {
  stage='candidate';
  const validated=await candidateOwner.npValidateConfiguredBuildCandidateV1({
    baseline:input.baseline,capture:candidateCapture,config,renderer:input.renderer,
    brief:input.brief,sealedDirections:input.directions,blueprint:input.blueprint,
    sourceDelta:input.sourceDelta});
  await writeFile(join(output,'candidate.json'),JSON.stringify(validated),{flag:'wx',mode:0o600});
} else if (input.mode === 'fixture' || input.mode === 'render' || input.mode === 'final-render' || input.mode === 'doctor' || input.mode === 'projection') {
  const brief = contract.npRequireBuildReadyBriefV1(input.brief);
  const set = await contract.npRequireBuildDirectionSetForBriefV1(brief,input.drafts,'draft');
  const fixtures = [];
  for (const sample of set.comparisonInputs.sampleContent) {
    const ref = contract.npRequireAgentBuildRenderFixtureRefV1(sample.data);
    const bytes = await readFile(join(project,ref.stagedArtifactPath));
    if (bytes.length > 4*1024*1024 || await contract.npBuildFileDigest('np.build-staged-artifact.v1',bytes) !== ref.digest)
      throw new Error('Fixture byte binding failed');
    const text = new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    fixtures.push({sampleId:sample.id,body:contract.npRequireAgentBuildRenderFixtureV1(JSON.parse(text))});
  }
  const fixtureOwner = await owner('@nexpress/app/lib/site-build-render-fixture');
  stage = 'projection';
  const fixture = await fixtureOwner.npPrepareConfiguredBuildRenderFixtureV1(config,input.renderer,
    defaults.npGetDefaultBuildOwnerBindingsV1(),brief,set,input.directionId,fixtures);
  let seedOwner, seedArtifact;
  if(input.mode==='final-render'||input.mode==='doctor') {
    stage='seed-reconciliation';
    const blueprint=await contract.npRequireBuildBlueprintForBriefV1(brief,input.blueprint);
    seedOwner=await owner('@nexpress/app/lib/site-build-seed');
    seedArtifact=seedOwner.npCreateSiteBuildSeedArtifactV1(blueprint,
      {id:fixture.theme.id,package:fixture.theme.package});
    seedOwner.npReconcileSiteBuildSeedArtifactV1(seedArtifact,fixture);
  }
  if(input.mode==='projection') {
    await writeFile(join(output,'fixture.json'),JSON.stringify(fixture),{flag:'wx',mode:0o600});
  } else {
  // A migration client closes before the application's sole bootstrap pool starts.
  // Only this fresh private database exists in the namespace; no URL comes from input.
  const pg = (await owner('pg')).default;
  stage = 'migration-driver';
  const {drizzle} = await owner('drizzle-orm/node-postgres');
  const {migrate} = await owner('drizzle-orm/node-postgres/migrator');
  const {readMigrationFiles} = await owner('drizzle-orm/migrator');
  stage = 'migration-read';
  readMigrationFiles({migrationsFolder:join(project,'drizzle')});
  stage = 'migration-connect';
  let client;
  const deadline = performance.now()+10000;
  while(performance.now()<deadline) {
    const candidate = new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:1000});
    try {await candidate.connect();await candidate.query('select 1');client=candidate;break;}
    catch {await candidate.end().catch(()=>{});await new Promise(done=>setTimeout(done,50));}
  }
  if(!client)throw new Error('Fixture database unavailable');
  stage = 'migration-apply';
  try { await migrate(drizzle(client),{migrationsFolder:join(project,'drizzle')}); }
  finally { await client.end(); }
  stage = 'bootstrap-import';
  const bootstrap = await import(pathToFileURL(join(project,'src/lib/bootstrap.ts')).href);
  let materialized = false;
  try {
    stage = 'bootstrap';
    await bootstrap.ensureFor('write');
    const core = await owner('@nexpress/core');
    await (await owner('@nexpress/core/sites')).ensureDefaultSite();
    stage = 'site-settings';
    const site = await core.getSiteGeneralSettings();
    // Normal metadata reads the actual site settings, not the SITE_URL env.
    // This job owns a fresh synthetic database and its fixed loopback origin.
    await core.setSiteGeneralSettings({...site,url:'http://127.0.0.1:18080',
      description:brief.project.summary});
    const db = bootstrap.getDb();
    stage = 'principal';
    // The registry creates its own synthetic principal in its own newly migrated DB.
    // This uses the same seed-admin owner projection, never a supplied principal or role.
    const actor = {id:'00000000-0000-4000-8000-fffffffffff1',email:'build-fixture@example.invalid',
      name:'Build fixture',role:'admin',tokenVersion:0};
    await db.insert(core.npUsers).values({...actor,
      password:await core.hashPassword('np-build-synthetic-principal-password-v1'),
      createdAt:new Date(),updatedAt:new Date()});
    if(fixture.pageDocuments.some(page=>page.sessionRequired==='member')) {
      stage = 'member-principal';
      const [member] = await db.insert(core.npMembers).values({
        id:'00000000-0000-4000-8000-fffffffffff2',
        email:'build-member@example.invalid',handle:'np-build-fixture-member',
        displayName:'Build fixture member',
        password:await core.hashPassword('np-build-synthetic-member-password-v1'),
        status:'active',emailVerified:true,
      }).returning({id:core.npMembers.id,email:core.npMembers.email,
        handle:core.npMembers.handle,displayName:core.npMembers.displayName,
        status:core.npMembers.status,tokenVersion:core.npMembers.tokenVersion});
      if(!member)throw new Error('Fixture member unavailable');
      stage = 'member-session';
      const session=await core.createMemberSession(member,process.env.NP_SECRET,db,
        {accessExpiration:7200,refreshExpiration:604800});
      // Private job transport only: never exported to a Build artifact, log or model input.
      await writeFile(join(output,'member-session.json'),JSON.stringify({
        schemaVersion:'np.site-build-private-member-session.v1',access:session.access
      }),{flag:'wx',mode:0o600});
    }
    if(input.mode==='final-render'||input.mode==='doctor') {
      stage='seed-materialization';
      const materialization=await seedOwner.npMaterializeSiteBuildSeedV1(seedArtifact,actor,
        {ownerBindings:defaults.npGetDefaultBuildOwnerBindingsV1(),status:'published'});
      await writeFile(join(output,'seed-materialization.json'),JSON.stringify(materialization),{flag:'wx',mode:0o600});
    } else {
    stage = 'theme';
    await core.setActiveThemeId(fixture.theme.id,actor.id);
    const active = await core.getActiveTheme();
    await core.setTheme(core.npMergeThemeTokens(core.DEFAULT_THEME,active?.impl?.tokens,fixture.theme.tokens),actor);
    stage = 'documents';
    for (const document of fixture.documents) {
      const data = {...document.data};
      if (document.locale !== null) {
        data.locale = document.locale;
        data.translationGroupId = document.translationGroupId;
      }
      const saved = await core.saveDocument(document.collection,null,data,actor,
        {createId:document.documentId,status:'published'});
      if (saved.doc.id !== document.documentId) throw new Error('Fixture identity changed');
    }
    stage = 'navigation';
    for (const navigation of fixture.navigation)
      await core.setNavigation(navigation.location,navigation.items,actor);
    }
    await writeFile(join(output,'fixture.json'),JSON.stringify(fixture),{flag:'wx',mode:0o600});
    if(input.mode==='doctor') {
      stage='doctor-environment';
      const environmentFile=join(output,'doctor-environment.input');
      const environmentBytes=['DATABASE_URL','NP_SECRET','SITE_URL'].map(name=>{
        const value=doctorEnvironment[name];
        if(typeof value!=='string'||!value.length||/[\r\n\0]/.test(value))throw new Error('Invalid fixed Doctor environment');
        return name+'='+value+'\n';
      }).join('');
      await writeFile(environmentFile,environmentBytes,{flag:'wx',mode:0o600});
      stage='doctor';
      // Run every ordinary App check against the real project and this job's
      // migrated/materialized private DB. Errors remain in the unchanged report.
      const checks=await collectDoctorChecks({prodMode:false,target:null,cwd:project,
        env:doctorEnvironment,environmentFile});
      const report=buildDoctorJson({prodMode:false,target:null,checks});
      const bytes=JSON.stringify(report);
      if(Buffer.byteLength(bytes)>256*1024)throw new Error('Doctor report exceeds limit');
      await writeFile(join(output,'doctor-report.json'),bytes,{flag:'wx',mode:0o600});
      process.stdout.write(bytes+'\n');
    }
    materialized = true;
  } finally { if(materialized)stage = 'shutdown'; await bootstrap.shutdownBootstrap(); }
  }
} else throw new Error('Unsupported fixed worker mode');
} catch (error) {
  const databaseReasons = {
    '42P01':'missing-relation','42703':'missing-column','42704':'missing-object',
    '42710':'duplicate-object','42P07':'duplicate-relation','23503':'foreign-key',
    '23505':'unique-constraint','23514':'check-constraint','42501':'database-permission',
    '58P01':'database-file','53100':'database-disk','53200':'database-memory',
    '57014':'database-cancelled','08006':'database-connection',
    'ENOENT':'missing-file','EACCES':'file-permission','EROFS':'readonly-file',
    'ERR_INVALID_ARG_TYPE':'invalid-argument','ECONNRESET':'database-reset',
    'EPIPE':'database-pipe','ETIMEDOUT':'database-timeout'
    ,'ERR_MODULE_NOT_FOUND':'missing-module','MODULE_NOT_FOUND':'missing-module',
    'ERR_PACKAGE_PATH_NOT_EXPORTED':'package-export','ERR_UNKNOWN_FILE_EXTENSION':'module-extension'
  };
  let reason = null, location = null, current = error;
  for(let index=0;index<4&&current&&typeof current==='object';index++) {
    if(Object.hasOwn(databaseReasons,current.code)) {reason=databaseReasons[current.code];break;}
    if(typeof current.code==='string'&&/^[A-Z0-9]{5}$/.test(current.code))reason='database-other';
    if(current.name==='TypeError')reason='type-error';
    if(current.name==='RangeError')reason='range-error';
    if(current.name==='ReferenceError')reason='reference-error';
    if(current.name==='SyntaxError')reason='syntax-error';
    if(['Module is outside the Build capsule','Unsupported capsule module protocol','Invalid project alias','Build capsule loader is unavailable','Build module exceeds limit','Build module syntax is invalid'].includes(current.message))reason='module-boundary';
    if(typeof current.message==='string'&&current.message.includes("meta/_journal.json"))reason='migration-journal';
    if(typeof current.message==='string'&&current.message.startsWith('No file '))reason='migration-file';
    if(typeof current.message==='string'&&current.message.startsWith('Connection terminated'))reason='database-terminated';
    if(typeof current.message==='string'&&current.message.includes('not queryable'))reason='database-unqueryable';
    if(current.message==='Query read timeout')reason='database-timeout';
    if(typeof current.stack==='string') {
      const owners = [
        ['drizzle-driver',/\/drizzle-orm\/node-postgres\/driver\.(?:cjs|js):(\d+):/],
        ['drizzle-session',/\/drizzle-orm\/(?:node-postgres|pg-core)\/session\.(?:cjs|js):(\d+):/],
        ['drizzle-dialect',/\/drizzle-orm\/pg-core\/dialect\.(?:cjs|js):(\d+):/],
        ['drizzle-migration-loader',/\/drizzle-orm\/(?:node-postgres\/)?migrator\.(?:cjs|js):(\d+):/],
        ['postgres-client',/\/pg\/lib\/client\.js:(\d+):/],
        ['postgres-parser',/\/pg-protocol\/dist\/parser\.js:(\d+):/],
        ['worker',/\/opt\/np\/driver\/worker\.mjs:(\d+):/]
        ,['loader',/\/dist\/site-build-loader\.js:(\d+):/]
      ];
      for(const [owner,pattern] of owners){const match=current.stack.match(pattern);if(match&&Number(match[1])<=10000){location={owner,line:Number(match[1])};break;}}
    }
    current=current.cause;
  }
  await writeFile(join(output,'fixture-result.json'),JSON.stringify({
    schemaVersion:'np.site-build-fixture-result.v1',status:'failed',stage,reason,location
  }),{flag:'wx',mode:0o600});
  throw new Error('fixed-worker-failed');
}
`;

/** Freeze the framework clock, while native timers retain real deadlines. No inherited Node preload. */
export const NP_SITE_BUILD_RENDER_CLOCK_SOURCE_V1 = String.raw`
import { readFileSync } from 'node:fs';
const input = JSON.parse(readFileSync('/np/project/.nexpress/site/tmp/render-input.json','utf8'));
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.clockNow) ||
    new Date(input.clockNow).toISOString() !== input.clockNow || !/^[a-f0-9]{64}$/.test(input.randomSeed))
  throw new Error('Invalid fixed render clock');
const OriginalDate = Date, now = OriginalDate.parse(input.clockNow);
globalThis.Date = new Proxy(OriginalDate,{
  apply(){return new OriginalDate(now).toString();},
  construct(target,args,newTarget){return Reflect.construct(target,args.length?args:[now],newTarget);},
  get(target,key,receiver){return key==='now'?()=>now:Reflect.get(target,key,receiver);}
});
let state = Number.parseInt(input.randomSeed.slice(0,8),16) || 1;
Math.random = () => {state ^= state << 13;state ^= state >>> 17;state ^= state << 5;return (state>>>0)/4294967296;};
`;
