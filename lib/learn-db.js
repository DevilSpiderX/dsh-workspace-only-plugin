import{createRequire as e}from"node:module";import{desc as t,eq as n,like as r,lt as i,or as a}from"drizzle-orm";import{drizzle as o}from"drizzle-orm/node-sqlite";import{integer as s,sqliteTable as c,text as l}from"drizzle-orm/sqlite-core";var u=c(`hit_events`,{id:s(`id`).primaryKey({autoIncrement:!0}),at:s(`at`).notNull(),tool:l(`tool`).notNull(),command:l(`command`),token:l(`token`).notNull(),shapeSig:l(`shape_sig`).notNull(),role:l(`role`).notNull(),shape:l(`shape`),hitReason:l(`hit_reason`).notNull(),isFocus:s(`is_focus`).notNull(),verdict:l(`verdict`).notNull()}),d=c(`learned_exemptions`,{shape:l(`shape`).primaryKey(),allowCount:s(`allow_count`).notNull().default(0),denyCount:s(`deny_count`).notNull().default(0),timeoutCount:s(`timeout_count`).notNull().default(0),exempt:s(`exempt`).notNull().default(0),updatedAt:s(`updated_at`).notNull()}),f={available:!1,recordHit:()=>{},features:()=>[],writeFeature:()=>{},removeFeature:()=>!1,search:()=>[],prune:()=>{},close:()=>{}},p=1,m=`
CREATE TABLE IF NOT EXISTS hit_events (
    id INTEGER PRIMARY KEY,
    at INTEGER NOT NULL,
    tool TEXT NOT NULL,
    command TEXT,
    token TEXT NOT NULL,
    shape_sig TEXT NOT NULL,
    role TEXT NOT NULL,
    shape TEXT,
    hit_reason TEXT NOT NULL,
    is_focus INTEGER NOT NULL,
    verdict TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_shape ON hit_events(shape_sig, at);
CREATE INDEX IF NOT EXISTS idx_events_time ON hit_events(at);
CREATE TABLE IF NOT EXISTS learned_exemptions (
    shape TEXT PRIMARY KEY,
    allow_count INTEGER NOT NULL DEFAULT 0,
    deny_count INTEGER NOT NULL DEFAULT 0,
    timeout_count INTEGER NOT NULL DEFAULT 0,
    exempt INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);
`;function h(r){let s;try{s=new(e(import.meta.url)(`node:sqlite`)).DatabaseSync(r),s.exec(`PRAGMA journal_mode = WAL;`);let t=s.prepare(`PRAGMA user_version;`).get(),n=Number(t?.user_version??0);if(n>p)throw Error(`learn db schema ${n} is newer than ${p}`);s.exec(m),n<p&&s.exec(`PRAGMA user_version = ${p};`)}catch{try{s?.close()}catch{}return f}let c=s,l=o({client:c});return{available:!0,recordHit(e){try{l.insert(u).values({at:e.at,tool:e.tool,command:e.command.slice(0,2048),token:e.token.slice(0,512),shapeSig:e.shapeSig,role:e.role,shape:e.shape,hitReason:e.hitReason,isFocus:+!!e.isFocus,verdict:e.verdict}).run()}catch{}},features(){try{return l.select().from(d).all().map(e=>({shape:e.shape,allowCount:e.allowCount,denyCount:e.denyCount,timeoutCount:e.timeoutCount,exempt:e.exempt===1,updatedAt:e.updatedAt}))}catch{return[]}},writeFeature(e){try{l.insert(d).values({shape:e.shape,allowCount:e.allowCount,denyCount:e.denyCount,timeoutCount:e.timeoutCount,exempt:+!!e.exempt,updatedAt:e.updatedAt}).onConflictDoUpdate({target:d.shape,set:{allowCount:e.allowCount,denyCount:e.denyCount,timeoutCount:e.timeoutCount,exempt:+!!e.exempt,updatedAt:e.updatedAt}}).run()}catch{}},removeFeature(e){try{let t=l.select().from(d).where(n(d.shape,e)).get();return l.delete(d).where(n(d.shape,e)).run(),t!==void 0}catch{return!1}},search(e,n){try{let r=`%${e.replace(/[%_]/g,` `)}%`;return l.select().from(u).where(a(g(r),_(r),v(r))).orderBy(t(u.at)).limit(Math.max(1,Math.min(n,500))).all().map(e=>({at:e.at,tool:e.tool,command:e.command??``,token:e.token,shapeSig:e.shapeSig,role:e.role,shape:e.shape,hitReason:e.hitReason,isFocus:e.isFocus===1,verdict:e.verdict}))}catch{return[]}},prune(e){try{l.delete(u).where(i(u.at,e)).run()}catch{}},close(){try{c.close()}catch{}}}}var g=e=>r(u.token,e),_=e=>r(u.command,e),v=e=>r(u.shapeSig,e);export{h as openLearnDb};