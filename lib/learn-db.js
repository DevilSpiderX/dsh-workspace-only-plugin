import{uuidv7 as e}from"./uuid.js";import{createRequire as t}from"node:module";import{desc as n,eq as r,like as i,lt as a,or as o}from"drizzle-orm";import{drizzle as s}from"drizzle-orm/node-sqlite";import{integer as c,sqliteTable as l,text as u}from"drizzle-orm/sqlite-core";var d=l(`hit_events`,{id:u(`id`).primaryKey(),at:c(`at`).notNull(),tool:u(`tool`).notNull(),command:u(`command`),token:u(`token`).notNull(),shapeSig:u(`shape_sig`).notNull(),role:u(`role`).notNull(),shape:u(`shape`),hitReason:u(`hit_reason`).notNull(),isFocus:c(`is_focus`).notNull(),sessionId:u(`session_id`),verdict:u(`verdict`).notNull()}),f=l(`learned_exemptions`,{id:u(`id`).primaryKey(),shape:u(`shape`).notNull().unique(),allowCount:c(`allow_count`).notNull().default(0),denyCount:c(`deny_count`).notNull().default(0),timeoutCount:c(`timeout_count`).notNull().default(0),exempt:c(`exempt`).notNull().default(0),updatedAt:c(`updated_at`).notNull()}),p=l(`approval_events`,{id:u(`id`).primaryKey(),at:c(`at`).notNull(),tool:u(`tool`).notNull(),command:u(`command`),dir:u(`dir`).notNull(),reason:u(`reason`),targets:u(`targets`),sensitive:c(`sensitive`).notNull().default(0),verdict:u(`verdict`).notNull(),channel:u(`channel`).notNull(),ms:c(`ms`).notNull(),sessionId:u(`session_id`)}),m={available:!1,recordHit:()=>{},recordApproval:()=>{},features:()=>[],writeFeature:()=>{},removeFeature:()=>!1,search:()=>[],searchApprovals:()=>[],prune:()=>{},close:()=>{}},h=2,g=`
CREATE TABLE IF NOT EXISTS hit_events (
    id TEXT PRIMARY KEY,
    at INTEGER NOT NULL,
    tool TEXT NOT NULL,
    command TEXT,
    token TEXT NOT NULL,
    shape_sig TEXT NOT NULL,
    role TEXT NOT NULL,
    shape TEXT,
    hit_reason TEXT NOT NULL,
    is_focus INTEGER NOT NULL,
    session_id TEXT,
    verdict TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_shape ON hit_events(shape_sig, at);
CREATE INDEX IF NOT EXISTS idx_events_time ON hit_events(at);
CREATE TABLE IF NOT EXISTS learned_exemptions (
    id TEXT PRIMARY KEY,
    shape TEXT NOT NULL UNIQUE,
    allow_count INTEGER NOT NULL DEFAULT 0,
    deny_count INTEGER NOT NULL DEFAULT 0,
    timeout_count INTEGER NOT NULL DEFAULT 0,
    exempt INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS approval_events (
    id TEXT PRIMARY KEY,
    at INTEGER NOT NULL,
    tool TEXT NOT NULL,
    command TEXT,
    dir TEXT NOT NULL,
    reason TEXT,
    targets TEXT,
    sensitive INTEGER NOT NULL DEFAULT 0,
    verdict TEXT NOT NULL,
    channel TEXT NOT NULL,
    ms INTEGER NOT NULL,
    session_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_approval_time ON approval_events(at);
CREATE INDEX IF NOT EXISTS idx_approval_verdict ON approval_events(verdict, at);
`,_=`
DROP TABLE IF EXISTS hit_events;
DROP TABLE IF EXISTS learned_exemptions;
DROP TABLE IF EXISTS approval_events;
`;function v(c){let l;try{l=new(t(import.meta.url)(`node:sqlite`)).DatabaseSync(c),l.exec(`PRAGMA journal_mode = WAL;`);let e=l.prepare(`PRAGMA user_version;`).get(),n=Number(e?.user_version??0);if(n>h)throw Error(`learn db schema ${n} is newer than ${h}`);n<h&&l.exec(_),l.exec(g),l.exec(`PRAGMA user_version = ${h};`)}catch{try{l?.close()}catch{}return m}let u=l,v=s({client:u});return{available:!0,recordHit(t){try{v.insert(d).values({id:e(),at:t.at,tool:t.tool,command:t.command.slice(0,2048),token:t.token.slice(0,512),shapeSig:t.shapeSig,role:t.role,shape:t.shape,hitReason:t.hitReason,isFocus:+!!t.isFocus,sessionId:t.sessionId,verdict:t.verdict}).run()}catch{}},recordApproval(t){try{v.insert(p).values({id:e(),at:t.at,tool:t.tool,command:t.command.slice(0,4096),dir:t.dir,reason:t.reason.slice(0,2048),targets:t.targets.slice(0,4096),sensitive:+!!t.sensitive,verdict:t.verdict,channel:t.channel,ms:t.ms,sessionId:t.sessionId}).run()}catch{}},features(){try{return v.select().from(f).all().map(e=>({shape:e.shape,allowCount:e.allowCount,denyCount:e.denyCount,timeoutCount:e.timeoutCount,exempt:e.exempt===1,updatedAt:e.updatedAt}))}catch{return[]}},writeFeature(t){try{v.insert(f).values({id:e(),shape:t.shape,allowCount:t.allowCount,denyCount:t.denyCount,timeoutCount:t.timeoutCount,exempt:+!!t.exempt,updatedAt:t.updatedAt}).onConflictDoUpdate({target:f.shape,set:{allowCount:t.allowCount,denyCount:t.denyCount,timeoutCount:t.timeoutCount,exempt:+!!t.exempt,updatedAt:t.updatedAt}}).run()}catch{}},removeFeature(e){try{let t=v.select().from(f).where(r(f.shape,e)).get();return v.delete(f).where(r(f.shape,e)).run(),t!==void 0}catch{return!1}},search(e,t){try{let r=`%${e.replace(/[%_]/g,` `)}%`;return v.select().from(d).where(o(y(r),b(r),x(r))).orderBy(n(d.at)).limit(Math.max(1,Math.min(t,500))).all().map(e=>({id:String(e.id),at:e.at,tool:e.tool,command:e.command??``,token:e.token,shapeSig:e.shapeSig,role:e.role,shape:e.shape,hitReason:e.hitReason,isFocus:e.isFocus===1,sessionId:e.sessionId??``,verdict:e.verdict}))}catch{return[]}},searchApprovals(e,t){try{let r=`%${e.replace(/[%_]/g,` `)}%`;return v.select().from(p).where(o(i(p.tool,r),i(p.command,r),i(p.dir,r),i(p.reason,r),i(p.verdict,r))).orderBy(n(p.at)).limit(Math.max(1,Math.min(t,500))).all().map(e=>({id:String(e.id),at:e.at,tool:e.tool,command:e.command??``,dir:e.dir,reason:e.reason??``,targets:e.targets??`[]`,sensitive:e.sensitive===1,verdict:e.verdict,channel:e.channel,ms:e.ms,sessionId:e.sessionId??``}))}catch{return[]}},prune(e){try{v.delete(d).where(a(d.at,e)).run(),v.delete(p).where(a(p.at,e)).run()}catch{}},close(){try{u.close()}catch{}}}}var y=e=>i(d.token,e),b=e=>i(d.command,e),x=e=>i(d.shapeSig,e);export{v as openLearnDb};