import { Model, DataTypes, Sequelize, Optional } from 'sequelize';
import { JobStatus } from '../domain/job-status.enum';
import { JobEntity } from '../domain/job.types';

export interface JobAttributes {
  id: number;
  job_id: string;
  payload: string;
  status: JobStatus;
  run_after: Date;
  attempt_count: number;
  max_attempts: number;
  lease_owner: string | null;
  lease_token: string | null;
  lease_until: Date | null;
  fail_times: number;
  last_error: string | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface JobCreationAttributes extends Optional<JobAttributes, 'id' | 'status' | 'attempt_count' | 'max_attempts' | 'lease_owner' | 'lease_token' | 'lease_until' | 'fail_times' | 'last_error' | 'completed_at' | 'created_at' | 'updated_at'> {}

export class JobModel extends Model<JobAttributes, JobCreationAttributes> implements JobAttributes {
  public declare id: number;
  public declare job_id: string;
  public declare payload: string;
  public declare status: JobStatus;
  public declare run_after: Date;
  public declare attempt_count: number;
  public declare max_attempts: number;
  public declare lease_owner: string | null;
  public declare lease_token: string | null;
  public declare lease_until: Date | null;
  public declare fail_times: number;
  public declare last_error: string | null;
  public declare completed_at: Date | null;
  public declare readonly created_at: Date;
  public declare readonly updated_at: Date;

  public toEntity(): JobEntity {
    return {
      id: this.id,
      jobId: this.job_id,
      payload: this.payload,
      status: this.status,
      runAfter: this.run_after,
      attemptCount: this.attempt_count,
      maxAttempts: this.max_attempts,
      leaseOwner: this.lease_owner,
      leaseToken: this.lease_token,
      leaseUntil: this.lease_until,
      failTimes: this.fail_times,
      lastError: this.last_error,
      completedAt: this.completed_at,
      createdAt: this.created_at,
      updatedAt: this.updated_at
    };
  }
}

export function initJobModel(sequelize: Sequelize): typeof JobModel {
  JobModel.init(
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true
      },
      job_id: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true
      },
      payload: {
        type: DataTypes.TEXT,
        allowNull: false
      },
      status: {
        type: DataTypes.ENUM(...Object.values(JobStatus)),
        allowNull: false,
        defaultValue: JobStatus.READY
      },
      run_after: {
        type: DataTypes.DATE(3),
        allowNull: false
      },
      attempt_count: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 0
      },
      max_attempts: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 3
      },
      lease_owner: {
        type: DataTypes.STRING(128),
        allowNull: true
      },
      lease_token: {
        type: DataTypes.STRING(64),
        allowNull: true
      },
      lease_until: {
        type: DataTypes.DATE(3),
        allowNull: true
      },
      fail_times: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 0
      },
      last_error: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      completed_at: {
        type: DataTypes.DATE(3),
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
      tableName: 'jobs',
      timestamps: true,
      underscored: true
    }
  );

  return JobModel;
}
