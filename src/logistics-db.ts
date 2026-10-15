import type { Exec } from "./db.ts";
import {
  checkDocuments,
  laneFromTasks,
  LANES,
  TASK_TEMPLATES,
  type Doc,
  type DocType,
  type Finding,
  type Job,
  type Kind
} from "./logistics.ts";

export type JobTask = {
  id: number;
  seq: number;
  lane: number;
  title: string;
  done: boolean;
  doneAt: string | null;
};
export type JobDoc = Doc & { id: number; updatedAt: string };
export type JobReview = {
  id: number;
  runAt: string;
  findings: Finding[];
  aiText: string | null;
};

export type JobView = Job & {
  id: number;
  laneLabel: string;
  lanes: string[];
  simulated: boolean;
  createdAt: string;
  tasks: JobTask[];
  docs: JobDoc[];
  /** Live rule-check results for the current document set */
  findings: Finding[];
  review: JobReview | null;
};

export type NewJob = Omit<Job, "id" | "lane"> & { simulated: boolean };

export const LG_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS lg_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('final_mile', 'export', 'import')),
    origin TEXT NOT NULL,
    destination TEXT NOT NULL,
    origin_country TEXT NOT NULL,
    destination_country TEXT NOT NULL,
    forwarder TEXT NOT NULL,
    incoterm TEXT NOT NULL DEFAULT '',
    manifest TEXT,
    rma_shipment_id INTEGER,
    simulated INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS lg_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES lg_jobs(id),
    seq INTEGER NOT NULL,
    lane INTEGER NOT NULL,
    title TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    done_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS lg_docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES lg_jobs(id),
    type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'final')),
    version INTEGER NOT NULL DEFAULT 1,
    fields TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (job_id, type)
  )`,
  `CREATE TABLE IF NOT EXISTS lg_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES lg_jobs(id),
    run_at TEXT NOT NULL,
    findings TEXT NOT NULL,
    ai_text TEXT
  )`
];

/** Child tables first, for deletes. */
export const LG_TABLES = ["lg_reviews", "lg_docs", "lg_tasks", "lg_jobs"];

/** Creates a job with its task checklist; marks the first `tasksDone` tasks done. */
export function insertJob(
  exec: Exec,
  job: NewJob,
  now: Date,
  tasksDone = 0
): number {
  const [row] = exec(
    `INSERT INTO lg_jobs (ref, kind, origin, destination, origin_country, destination_country, forwarder, incoterm, manifest, rma_shipment_id, simulated, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    job.ref,
    job.kind,
    job.origin,
    job.destination,
    job.originCountry,
    job.destinationCountry,
    job.forwarder,
    job.incoterm,
    job.manifest ? JSON.stringify(job.manifest) : null,
    job.rmaShipmentId,
    job.simulated ? 1 : 0,
    now.toISOString()
  );
  const id = Number(row.id);
  TASK_TEMPLATES[job.kind].forEach((t, i) => {
    exec(
      `INSERT INTO lg_tasks (job_id, seq, lane, title, done, done_at) VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      i,
      t.lane,
      t.title,
      i < tasksDone ? 1 : 0,
      i < tasksDone ? now.toISOString() : null
    );
  });
  return id;
}

/** Inserts or replaces a job's document of that type. */
export function upsertDoc(exec: Exec, jobId: number, doc: Doc, now: Date) {
  exec(
    `INSERT INTO lg_docs (job_id, type, status, version, fields, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(job_id, type) DO UPDATE SET status = excluded.status, version = excluded.version,
       fields = excluded.fields, updated_at = excluded.updated_at`,
    jobId,
    doc.type,
    doc.status,
    doc.version,
    JSON.stringify(doc.fields),
    now.toISOString()
  );
}

export function setDocStatus(
  exec: Exec,
  docId: number,
  status: "draft" | "final",
  now: Date
) {
  exec(
    `UPDATE lg_docs SET status = ?, updated_at = ? WHERE id = ?`,
    status,
    now.toISOString(),
    docId
  );
}

export function toggleTask(exec: Exec, taskId: number, now: Date) {
  exec(
    `UPDATE lg_tasks SET done = 1 - done, done_at = CASE WHEN done = 0 THEN ? ELSE NULL END WHERE id = ?`,
    now.toISOString(),
    taskId
  );
}

/** Marks a job's task done by title (events from the RMA lifecycle). */
export function completeTask(
  exec: Exec,
  jobId: number,
  title: string,
  now: Date
) {
  exec(
    `UPDATE lg_tasks SET done = 1, done_at = ? WHERE job_id = ? AND title = ? AND done = 0`,
    now.toISOString(),
    jobId,
    title
  );
}

export function insertReview(
  exec: Exec,
  jobId: number,
  findings: Finding[],
  aiText: string | null,
  now: Date
) {
  exec(
    `INSERT INTO lg_reviews (job_id, run_at, findings, ai_text) VALUES (?, ?, ?, ?)`,
    jobId,
    now.toISOString(),
    JSON.stringify(findings),
    aiText
  );
}

export function nextRef(exec: Exec, kind: Kind, now: Date) {
  const prefix = { final_mile: "FM", export: "EXP", import: "IMP" }[kind];
  const yy = String(now.getUTCFullYear()).slice(2);
  const [row] = exec(`SELECT COUNT(*) AS n FROM lg_jobs WHERE kind = ?`, kind);
  return `${prefix}-${yy}${String(Number(row.n) + 1).padStart(2, "0")}`;
}

export function jobIdForRma(exec: Exec, rmaShipmentId: number): number | null {
  const [row] = exec(
    `SELECT id FROM lg_jobs WHERE rma_shipment_id = ? LIMIT 1`,
    rmaShipmentId
  );
  return row ? Number(row.id) : null;
}

export function listJobs(exec: Exec): JobView[] {
  const tasks = exec(`SELECT * FROM lg_tasks ORDER BY job_id, seq`);
  const docs = exec(`SELECT * FROM lg_docs ORDER BY job_id, id`);
  const reviews = exec(`SELECT * FROM lg_reviews ORDER BY id DESC`);
  return exec(`SELECT * FROM lg_jobs ORDER BY id DESC`).map((j) => {
    const kind = j.kind as Kind;
    const jobTasks: JobTask[] = tasks
      .filter((t) => t.job_id === j.id)
      .map((t) => ({
        id: Number(t.id),
        seq: Number(t.seq),
        lane: Number(t.lane),
        title: String(t.title),
        done: Number(t.done) === 1,
        doneAt: t.done_at ? String(t.done_at) : null
      }));
    const jobDocs: JobDoc[] = docs
      .filter((d) => d.job_id === j.id)
      .map((d) => ({
        id: Number(d.id),
        type: d.type as DocType,
        status: d.status as "draft" | "final",
        version: Number(d.version),
        fields: JSON.parse(String(d.fields)),
        updatedAt: String(d.updated_at)
      }));
    const lane = laneFromTasks(kind, jobTasks);
    const job: Job = {
      id: Number(j.id),
      ref: String(j.ref),
      kind,
      origin: String(j.origin),
      destination: String(j.destination),
      originCountry: String(j.origin_country),
      destinationCountry: String(j.destination_country),
      forwarder: String(j.forwarder),
      incoterm: String(j.incoterm),
      lane,
      manifest: j.manifest ? JSON.parse(String(j.manifest)) : null,
      rmaShipmentId:
        j.rma_shipment_id == null ? null : Number(j.rma_shipment_id)
    };
    const r = reviews.find((x) => x.job_id === j.id);
    return {
      ...job,
      id: Number(j.id),
      laneLabel: LANES[kind][lane - 1],
      lanes: LANES[kind],
      simulated: Number(j.simulated) === 1,
      createdAt: String(j.created_at),
      tasks: jobTasks,
      docs: jobDocs,
      findings: checkDocuments(job, jobDocs),
      review: r
        ? {
            id: Number(r.id),
            runAt: String(r.run_at),
            findings: JSON.parse(String(r.findings)),
            aiText: r.ai_text ? String(r.ai_text) : null
          }
        : null
    };
  });
}
