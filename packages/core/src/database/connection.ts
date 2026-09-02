import { Sequelize, Options } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

export interface DbConfig {
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  poolMax?: number;
  poolMin?: number;
  logging?: boolean | ((sql: string, timing?: number) => void);
}

let sequelizeInstance: Sequelize | null = null;

export function getDatabaseConfig(override?: DbConfig): Options {
  const host = override?.host ?? process.env.DB_HOST ?? '127.0.0.1';
  const port = override?.port ?? parseInt(process.env.DB_PORT ?? '3306', 10);
  const database = override?.database ?? process.env.DB_NAME ?? 'job_queue_db';
  const username = override?.username ?? process.env.DB_USER ?? 'queue_user';
  const password = override?.password ?? process.env.DB_PASSWORD ?? 'queue_password';
  const poolMax = override?.poolMax ?? parseInt(process.env.DB_POOL_MAX ?? '20', 10);
  const poolMin = override?.poolMin ?? parseInt(process.env.DB_POOL_MIN ?? '2', 10);

  return {
    dialect: 'mysql',
    host,
    port,
    database,
    username,
    password,
    logging: override?.logging !== undefined ? override.logging : false,
    pool: {
      max: poolMax,
      min: poolMin,
      acquire: 30000,
      idle: 10000
    },
    define: {
      timestamps: true,
      underscored: true
    },
    timezone: '+00:00'
  };
}

export function initSequelize(override?: DbConfig): Sequelize {
  if (!sequelizeInstance || override) {
    const config = getDatabaseConfig(override);
    const instance = new Sequelize(config);
    if (!override) {
      sequelizeInstance = instance;
    }
    return instance;
  }
  return sequelizeInstance;
}

export function getSequelize(): Sequelize {
  if (!sequelizeInstance) {
    return initSequelize();
  }
  return sequelizeInstance;
}

export async function closeDatabase(instance?: Sequelize): Promise<void> {
  const target = instance ?? sequelizeInstance;
  if (target) {
    await target.close();
    if (target === sequelizeInstance) {
      sequelizeInstance = null;
    }
  }
}
