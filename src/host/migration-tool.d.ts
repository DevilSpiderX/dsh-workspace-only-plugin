/**
 * `@wuyuchentr/database-migration-tool` 的最小类型声明（包无 d.ts，
 * 按字面复刻用到的面——同 `dsh-augment.d.ts` 的做法）。
 */
declare module "@wuyuchentr/database-migration-tool" {
    export class Migrator {
        constructor(options: {
            driver?: "sqlite" | "mysql" | "postgres";
            database?: string;
            directory?: string;
            seedDirectory?: string;
            table?: string;
        });
        connect(): Promise<void>;
        disconnect(): Promise<void>;
        up(options?: {target?: string}): Promise<number>;
        down(options?: {step?: number}): Promise<number>;
        status(): Promise<Array<{name: string; timestamp: string; executed: boolean; hash: string | null}>>;
    }
}
