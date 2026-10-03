import { db } from "./src/db/index.js";
import { users, columnConfigs } from "./src/db/schema.js";
import bcrypt from "bcryptjs";

async function seed() {
  // Seed admin user
  const hash = await bcrypt.hash("admin", 10);
  await db
    .insert(users)
    .values({ username: "admin", passwordHash: hash, isAdmin: true })
    .onConflictDoNothing();

  // Seed column configs (8 columns exactly as described)
  const cols = [
    {
      key: "toplotna",
      label: "Toplotna",
      displayOrder: 1,
      sourceType: "formula",
      formula: "{toplotna_ogrevanje} + {toplotna_sanitarna}",
      unit: "kWh",
      editable: false,
    },
    {
      key: "toplotna_ogrevanje",
      label: "Topl. ogrevanje",
      displayOrder: 2,
      sourceType: "melcloud",
      formula: null,
      unit: "kWh",
      editable: true,
    },
    {
      key: "toplotna_sanitarna",
      label: "Topl. san. voda",
      displayOrder: 3,
      sourceType: "melcloud",
      formula: null,
      unit: "kWh",
      editable: true,
    },
    {
      key: "avto",
      label: "Avto",
      displayOrder: 4,
      sourceType: "manual",
      formula: null,
      unit: "kWh",
      editable: true,
    },
    {
      key: "gospodinjstvo",
      label: "Gospodinjstvo",
      displayOrder: 5,
      sourceType: "formula",
      formula: "{skupna_poraba} - {avto} - {toplotna_ogrevanje} - {toplotna_sanitarna}",
      unit: "kWh",
      editable: false,
    },
    {
      key: "solarna",
      label: "Sončna elektr.",
      displayOrder: 6,
      sourceType: "solaredge",
      formula: null,
      unit: "kWh",
      editable: true,
    },
    {
      key: "skupna_poraba",
      label: "Skupna poraba",
      displayOrder: 7,
      sourceType: "solaredge",
      formula: null,
      unit: "kWh",
      editable: true,
    },
    {
      key: "visek_manjko",
      label: "Višek/Manjko",
      displayOrder: 8,
      sourceType: "formula",
      formula: "{solarna} - {skupna_poraba}",
      unit: "kWh",
      editable: false,
    },
  ];

  for (const col of cols) {
    await db.insert(columnConfigs).values(col).onConflictDoNothing();
  }

  console.log("Seed complete: admin user + 8 columns");
  process.exit(0);
}

seed().catch(console.error);
