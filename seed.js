// seed.js (improved)
require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/audience';
const TOTAL = 200;

function randomInt(min, max){ return Math.floor(Math.random()*(max-min+1))+min; }
function randomName(i){ const names=['Asha','Vikram','Neha','Rohit','Priya','Arjun','Simran','Aditya','Kavya','Sai']; return names[i % names.length] + ' ' + (Math.floor(i/10)+1); }
function randomEmail(name,i){ return `${name.replace(/\s+/g,'').toLowerCase()}${i}@example.com`; }
function randomDatePast(daysBack){
  const now = Date.now();
  const past = now - Math.floor(Math.random()*daysBack*24*60*60*1000);
  return new Date(past);
}

(async function seed(){
  const client = new MongoClient(MONGO_URI, { useUnifiedTopology: true });
  try {
    await client.connect();
    console.log('Connected to', MONGO_URI);
    const db = client.db();
    const users = db.collection('users');
    const segments = db.collection('segments');
    const campaigns = db.collection('campaigns');

    await users.deleteMany({});
    await segments.deleteMany({});
    await campaigns.deleteMany({});

    // Insert users in batches
    const batch = [];
    let inserted = 0;
    for (let i=1;i<=TOTAL;i++){
      const name = randomName(i);
      batch.push({
        name,
        email: randomEmail(name,i),
        total_spend: Number((Math.random()*20000).toFixed(2)),
        visits: randomInt(0,50),
        last_active_at: randomDatePast(365),
        created_at: randomDatePast(800)
      });
      if (batch.length >= 1000) {
        const r = await users.insertMany(batch);
        inserted += r.insertedCount;
        batch.length = 0;
        console.log(`Inserted ${inserted}/${TOTAL} users...`);
      }
    }
    if (batch.length) {
      const r = await users.insertMany(batch);
      inserted += r.insertedCount;
      console.log(`Inserted ${inserted}/${TOTAL} users (final)`);
    } else {
      console.log(`Inserted ${inserted}/${TOTAL} users`);
    }

    // Create indexes for performance (optional, helpful)
    await users.createIndex({ total_spend: 1 });
    await users.createIndex({ visits: 1 });
    await users.createIndex({ last_active_at: 1 });

    // Insert sample segments (audience_size will be updated below)
    const segDocs = [
      {
        name: 'High spend low visits',
        rules: {
          op: "AND",
          children: [
            { op: "COND", field: "total_spend", operator: ">", value: 10000 },
            { op: "COND", field: "visits", operator: "<", value: 5 }
          ]
        },
        audience_size: 0,
        created_at: new Date()
      },
      {
        name: 'Inactive 90+ days',
        rules: { op:'COND', field:'last_active_days', operator: '>=', value: 90 },
        audience_size: 0,
        created_at: new Date()
      }
    ];
    const segRes = await segments.insertMany(segDocs);
    const segIds = Object.values(segRes.insertedIds);
    console.log('Inserted sample segments:', segIds);

    // Compute audience_size for each segment:
    // 1) High spend low visits: total_spend > 10000 AND visits < 5
    const q1 = { total_spend: { $gt: 10000 }, visits: { $lt: 5 } };
    const count1 = await users.countDocuments(q1);
    await segments.updateOne({ _id: segIds[0] }, { $set: { audience_size: count1 } });

    // 2) Inactive 90+ days: last_active_days >= 90  -> last_active_at <= (now - 90 days)
    const days = 90;
    const threshold = new Date(Date.now() - days*24*60*60*1000);
    const q2 = { last_active_at: { $lte: threshold } };
    const count2 = await users.countDocuments(q2);
    await segments.updateOne({ _id: segIds[1] }, { $set: { audience_size: count2 } });

    console.log(`Updated segment audience_size: ${count1} and ${count2}`);

    // Insert sample campaigns with the computed segment ids & sizes
    await campaigns.insertMany([
      { name: 'Promo Sept A', segment_id: segIds[0], audience_size: count1, sent_count: Math.max(0, count1-20), failed_count: 20, created_at: new Date() },
      { name: 'Re-engage Inactive', segment_id: segIds[1], audience_size: count2, sent_count: Math.max(0, count2-100), failed_count: 100, created_at: new Date() }
    ]);

    console.log('Seed complete — users, segments, campaigns populated.');
  } catch (err) {
    console.error('Seed error:', err);
  } finally {
    await client.close();
  }
})();
