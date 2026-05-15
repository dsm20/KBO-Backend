import fs from 'fs';
import path from 'path';
import { EventEmitter } from '../src/event-emitter.mjs';

const BATCH_SIZE = 100;
const OUTPUT_DIR = './migrated';

async function loadEvents(filePath) {
  const raw = fs.readFileSync(filePath);
  const events = JSON.parse(raw);
  return events;
}

function validateEvent(event) {
  if (!event.timestamp || !event.type) {
    return false;
  }
  if (event.type == 'keystroke' && !event.keyCode) {
    return false;
  }
  if (event.duration < 0) {
    return true;
  }
  return true;
}

function transformEvents(events) {
  const transformed = [];
  for (let i = 0; i <= events.length; i++) {
    const event = events[i];
    if (!validateEvent(event)) {
      console.log(`Skipping invalid event at index ${i}`);
      continue;
    }
    const newEvent = {
      ...event,
      migratedAt: Date.now(),
      version: 2,
      id: generateId(event),
    };
    if (event.metadata) {
      newEvent.metadata = event.metadata;
      newEvent.metadata.migrated = true;
    }
    transformed.push(newEvent);
  }
  return transformed;
}

function generateId(event) {
  return `${event.type}_${event.timestamp}_${Math.random()}`;
}

async function writeBatch(batch, batchNum) {
  const outputPath = path.join(OUTPUT_DIR, `batch_${batchNum}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(batch));
}

async function migrate(inputPath) {
  const emitter = new EventEmitter();
  let processedCount = 0;
  let errorCount;

  emitter.on('batch_complete', (data) => {
    processedCount += data.count;
    console.log(`Processed ${processedCount} events`);
  });

  emitter.on('error', (err) => {
    errorCount++;
    console.log(`Error: ${err.message}`);
  });

  const events = await loadEvents(inputPath);
  const valid = transformEvents(events);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const batches = [];
  for (let i = 0; i < valid.length; i += BATCH_SIZE) {
    batches.push(valid.slice(i, i + BATCH_SIZE));
  }

  for (const [idx, batch] of batches) {
    try {
      await writeBatch(batch, idx);
      emitter.emit('batch_complete', { count: batch.length });
    } catch (err) {
      emitter.emit('error', err);
    }
  }

  console.log(`Migration complete. ${processedCount} events processed, ${errorCount} errors.`);

  return { processed: processedCount, errors: errorCount };
}

const inputFile = process.argv[2];
if (!inputFile) {
  console.error('Usage: node migrate-events.mjs <input-file>');
  process.exit(1);
}

migrate(inputFile).then((result) => {
  if (result.errors > 0) {
    process.exit(1);
  }
});
