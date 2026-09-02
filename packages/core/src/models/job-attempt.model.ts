import { Model, DataTypes, Sequelize, Optional } from 'sequelize';
import { AttemptStatus } from '../domain/job-status.enum';
import { JobAttemptEntity } from '../domain/job.types';

export interface JobAttemptAttributes {
  id: number;
  job_id: string;
  attempt_number: number;
  worker_id: string;
  lease_token: string;
  started_at: Date;
  finished_at: Date | null;
  status: AttemptStatus;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface JobAttemptCreationAttributes extends Optional<JobAttemptAttributes, 'id' | 'finished_at' | 'error_message' | 'created_at' | 'updated_at'> {}

export class JobAttemptModel extends Model<JobAttemptAttributes, JobAttemptCreationAttributes> implements JobAttemptAttributes {
  public declare id: number;
  public declare job_id: string;
  public declare attempt_number: number;
  public declare worker_id: string;
  public declare lease_token: string;
  public declare started_at: Date;
  public declare finished_at: Date | null;
  public declare status: AttemptStatus;
  public declare error_message: string | null;
  public declare readonly created_at: Date;
  public declare readonly updated_at: Date;

  public toEntity(): JobAttemptEntity {
    return {
      id: this.id,
      jobId: this.job_id,
      attemptNumber: this.attempt_number,
      workerId: this.worker_id,
      leaseToken: this.lease_token,
      startedAt: this.started_at,
      finishedAt: this.finished_at,
      status: this.status,
      errorMessage: this.error_message,
      createdAt: this.created_at,
      updatedAt: this.updated_at
    };
  }
}

export function initJobAttemptModel(sequelize: Sequelize): typeof JobAttemptModel {
  JobAttemptModel.init(
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true
      },
      job_id: {
        type: DataTypes.STRING(64),
        allowNull: false
      },
      attempt_number: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false
      },
      worker_id: {
        type: DataTypes.STRING(128),
        allowNull: false
      },
      lease_token: {
        type: DataTypes.STRING(64),
        allowNull: false
      },
      started_at: {
        type: DataTypes.DATE(3),
        allowNull: false,
        defaultValue: DataTypes.NOW
      },
      finished_at: {
        type: DataTypes.DATE(3),
        allowNull: true
      },
      status: {
        type: DataTypes.ENUM(...Object.values(AttemptStatus)),
        allowNull: false,
        defaultValue: AttemptStatus.RUNNING
      },
      error_message: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      created_at: {
        type: DataTypes.DATE(3),
        allowNull: false,
        defaultValue: DataTypes.NOW
      },
      updated_at: {
        type: DataTypes.DATE(3),
        allowNull: false,
        defaultValue: DataTypes.NOW
      }
    },
    {
      sequelize,
      tableName: 'job_attempts',
      timestamps: true,
      underscored: true
    }
  );

  return JobAttemptModel;
}
