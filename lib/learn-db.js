import{createRequire as e}from"node:module";import{desc as t,eq as n,like as r,lt as i,or as a}from"drizzle-orm";import{drizzle as o}from"drizzle-orm/node-sqlite";import{integer as s,sqliteTable as c,text as l}from"drizzle-orm/sqlite-core";var u=c(`hit_events`,{id:s(`id`).primaryKey({autoIncrement:!0}),at:s(`at`).notNull(),tool:l(`tool`).notNull(),command:l(`command`),token:l(`token`).notNull(),shapeSig:l(`shape_sig`).notNull(),role:l(`role`).notNull(),shape:l(`shape`),hitReason:l(`hit_reason`).notNull(),isFocus:s(`is_focus`).notNull(),verdict:l(`verdict`).notNull()}),d=c(`learned_exemptions`,{shape:l(`shape`).primaryKey(),allowCount:s(`allow_count`).notNull().default(0),denyCount:s(`deny_count`).notNull().default(0),timeoutCount:s(`timeout_count`).notNull().default(0),exempt:s(`exempt`).notNull().default(0),updatedAt:s(`updated_at`).notNull()}),f=c(`approval_events`,{id:s(`id`).primaryKey({autoIncrement:!0}),at:s(`at`).notNull(),tool:l(`tool`).notNull(),command:l(`command`),dir:l(`dir`).notNull(),reason:l(`reason`),targets:l(`targets`),sensitive:s(`sensitive`).notNull().default(0),verdict:l(`verdict`).notNull(),channel:l(`channel`).notNull(),ms:s(`ms`).notNull(),sessionId:l(`session_id`)}),p={available:!1,recordHit:()=>{},recordApproval:()=>{},features:()=>[],writeFeature:()=>{},removeFeature:()=>!1,search:()=>[],searchApprovals:()=>[],prune:()=>{},close:()=>{}},m=2,h=`
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
CREATE TABLE IF NOT EXISTS approval_events (
    id INTEGER PRIMARY KEY,
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
`;function g(s){let c;try{c=new(e(import.meta.url)(`node:sqlite`)).DatabaseSync(s),c.exec(`PRAGMA journal_mode = WAL;`);let t=c.prepare(`PRAGMA user_version;`).get(),n=Number(t?.user_version??0);if(n>m)throw Error(`learn db schema ${n} is newer than ${m}`);c.exec(h),n<m&&c.exec(`PRAGMA user_version = ${m};`)}catch{try{c?.close()}catch{}return p}let l=c,g=o({client:l});return{available:!0,recordHit(e){try{g.insert(u).values({at:e.at,tool:e.tool,command:e.command.slice(0,2048),token:e.token.slice(0,512),shapeSig:e.shapeSig,role:e.role,shape:e.shape,hitReason:e.hitReason,isFocus:+!!e.isFocus,verdict:e.verdict}).run()}catch{}},recordApproval(e){try{g.insert(f).values({at:e.at,tool:e.tool,command:e.command.slice(0,4096),dir:e.dir,reason:e.reason.slice(0,2048),targets:e.targets.slice(0,4096),sensitive:+!!e.sensitive,verdict:e.verdict,channel:e.channel,ms:e.ms,sessionId:e.sessionId}).run()}catch{}},features(){try{return g.select().from(d).all().map(e=>({shape:e.shape,allowCount:e.allowCount,denyCount:e.denyCount,timeoutCount:e.timeoutCount,exempt:e.exempt===1,updatedAt:e.updatedAt}))}catch{return[]}},writeFeature(e){try{g.insert(d).values({shape:e.shape,allowCount:e.allowCount,denyCount:e.denyCount,timeoutCount:e.timeoutCount,exempt:+!!e.exempt,updatedAt:e.updatedAt}).onConflictDoUpdate({target:d.shape,set:{allowCount:e.allowCount,denyCount:e.denyCount,timeoutCount:e.timeoutCount,exempt:+!!e.exempt,updatedAt:e.updatedAt}}).run()}catch{}},removeFeature(e){try{let t=g.select().from(d).where(n(d.shape,e)).get();return g.delete(d).where(n(d.shape,e)).run(),t!==void 0}catch{return!1}},search(e,n){try{let r=`%${e.replace(/[%_]/g,` `)}%`;return g.select().from(u).where(a(_(r),v(r),y(r))).orderBy(t(u.at)).limit(Math.max(1,Math.min(n,500))).all().map(e=>({at:e.at,tool:e.tool,command:e.command??``,token:e.token,shapeSig:e.shapeSig,role:e.role,shape:e.shape,hitReason:e.hitReason,isFocus:e.isFocus===1,verdict:e.verdict}))}catch{return[]}},searchApprovals(e,n){try{let i=`%${e.replace(/[%_]/g,` `)}%`;return g.select().from(f).where(a(r(f.tool,i),r(f.command,i),r(f.dir,i),r(f.reason,i),r(f.verdict,i))).orderBy(t(f.at)).limit(Math.max(1,Math.min(n,500))).all().map(e=>({at:e.at,tool:e.tool,command:e.command??``,dir:e.dir,reason:e.reason??``,targets:e.targets??`[]`,sensitive:e.sensitive===1,verdict:e.verdict,channel:e.channel,ms:e.ms,sessionId:e.sessionId??``}))}catch{return[]}},prune(e){try{g.delete(u).where(i(u.at,e)).run(),g.delete(f).where(i(f.at,e)).run()}catch{}},close(){try{l.close()}catch{}}}}var _=e=>r(u.token,e),v=e=>r(u.command,e),y=e=>r(u.shapeSig,e);export{g as openLearnDb};