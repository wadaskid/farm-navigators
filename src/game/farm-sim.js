// src/game/farm-sim.js
import Phaser from "phaser";

export function createFarmSim({ lat = 12, lon = 8.5, crop = "maize", days = 10 }) {
  const WIDTH = 900,
    HEIGHT = 600;
  const config = {
    type: Phaser.AUTO,
    width: WIDTH,
    height: HEIGHT,
    parent: "game-root",
    backgroundColor: "#7ec8e3",
    scene: { preload, create, update },
  };

  // --- GAME STATE ---
  let week = 1;
  let cropHealth = 80;
  let sustainability = 100;
  let profit = 10;
  let yieldScore = 0;
  let soilMoisture = 55;
  let nitrogen = 40;
  let pestPressure = 10;
  let waterTank = 180;
  const TANK_CAP = 200;
  let dripInstalled = false;
  let marketPrice = 1.1;
  let lastSummary = "";
  let rainfallLevels = Array(days).fill("medium");

  const hud = {};
  let cropCircle, drone;

  // Constants
  const COST_IRRIGATE = 3,
    COST_FERTILIZE = 2,
    COST_SCOUT = 1,
    COST_DRIP = 15,
    REVENUE_HEALTHY_WEEK = 4;
  const EVAPO_BASE = 6,
    IRR_VOL = 30,
    IRR_VOL_DRIP = 18,
    IRR_SM_GAIN = 10,
    IRR_SM_GAIN_DRIP = 14;

  function rainfallToLevel(mm) {
    if (mm < 2) return "low";
    if (mm < 10) return "medium";
    return "high";
  }

  function preload() {}

  function create() {
    const g = this.add.graphics();
    g.fillStyle(0x3e8e41, 1);
    g.fillRect(0, 120, WIDTH, HEIGHT - 160);
    g.lineStyle(2, 0xffffff, 0.2);
    for (let x = 0; x < WIDTH; x += 40) g.strokeRect(x, 120, 40, HEIGHT - 160);

    cropCircle = this.add.circle(WIDTH / 2, HEIGHT / 2 + 40, 40, 0x2ecc71);
    drone = this.add
      .rectangle(WIDTH - 160, 90, 120, 40, 0x222222)
      .setStrokeStyle(2, 0xffffff, 0.4);
    this.add.text(WIDTH - 210, 70, "Navigator Drone", {
      fontSize: "12px",
      color: "#e0e0e0",
    });
    hud.hint = this.add.text(WIDTH - 260, 84, "Analyzing...", {
      fontSize: "14px",
      color: "#031926",
      backgroundColor: "#5bc0be",
      padding: { left: 6, right: 6, top: 2, bottom: 2 },
    });

    hud.week = this.add.text(20, 20, "", { fontSize: "20px", color: "#fff" });
    hud.health = this.add.text(20, 50, "", { fontSize: "16px", color: "#fff" });
    hud.sustain = this.add.text(20, 74, "", { fontSize: "16px", color: "#fff" });
    hud.profit = this.add.text(20, 98, "", { fontSize: "16px", color: "#fff" });
    hud.yield = this.add.text(20, 122, "", { fontSize: "16px", color: "#fff" });

    hud.soil = this.add.text(20, 154, "", { fontSize: "16px", color: "#fff" });
    hud.nitro = this.add.text(20, 178, "", { fontSize: "16px", color: "#fff" });
    hud.pest = this.add.text(20, 202, "", { fontSize: "16px", color: "#fff" });
    hud.tank = this.add.text(20, 226, "", { fontSize: "16px", color: "#fff" });
    hud.price = this.add.text(20, 250, "", { fontSize: "16px", color: "#fff" });

    hud.summaryTitle = this.add.text(20, HEIGHT - 150, "Last Week", {
      fontSize: "16px",
      color: "#5bc0be",
    });
    hud.summary = this.add.text(20, HEIGHT - 130, "", {
      fontSize: "13px",
      color: "#e0e0e0",
      wordWrap: { width: 520 },
    });

    createButton(this, 40, HEIGHT - 60, "💧 Irrigate", () => act("irrigate"));
    createButton(this, 200, HEIGHT - 60, "🌱 Fertilize", () => act("fertilize"));
    createButton(this, 360, HEIGHT - 60, "🐛 Scout", () => act("scout"));
    createButton(this, 520, HEIGHT - 60, "⏳ Wait", () => act("wait"));

    createButton(this, 40, HEIGHT - 20, "🔧 Install Drip", installDrip);
    createButton(this, 200, HEIGHT - 20, "↻ Reset", resetGame);
    createButton(this, 360, HEIGHT - 20, "🛰️ Use Live Data", () =>
      fetchNasaPower(lat, lon)
    );

    updateHud();
    sayHint(currentRainLevel());
  }

  function update() {
    const radius = Phaser.Math.Linear(18, 60, cropHealth / 100);
    cropCircle.setRadius(radius);
    cropCircle.setFillStyle(healthColor());
  }

  function healthColor() {
    if (cropHealth > 70) return 0x2ecc71;
    if (cropHealth > 40) return 0xf1c40f;
    return 0xe74c3c;
  }

  function createButton(scene, x, y, label, onClick) {
    const btn = scene.add
      .rectangle(x, y, 150, 36, 0x5bc0be)
      .setOrigin(0, 1)
      .setStrokeStyle(2, 0x0b132b, 0.9);
    const txt = scene.add.text(x + 12, y - 26, label, {
      fontSize: "16px",
      color: "#031926",
      fontStyle: "bold",
    });
    btn.setInteractive({ useHandCursor: true }).on("pointerdown", onClick);
    txt.setInteractive({ useHandCursor: true }).on("pointerdown", onClick);
    btn.on("pointerover", () => btn.setFillStyle(0x7fd7d5));
    btn.on("pointerout", () => btn.setFillStyle(0x5bc0be));
  }

  // 🔹 NASA POWER fetch (with your dynamic lat/lon)
  async function fetchNasaPower(lat, lon) {
    try {
      const end = new Date();
      const start = new Date(end.getTime() - 9 * 24 * 3600 * 1000);
      const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
      const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOT&start=${fmt(
        start
      )}&end=${fmt(end)}&latitude=${lat}&longitude=${lon}&format=JSON`;
      const res = await fetch(url);
      const data = await res.json();
      const vals = Object.values(data?.properties?.parameter?.PRECTOT || {});
      if (vals.length) {
        const mapped = vals.map((v) => rainfallToLevel(Number(v)));
        rainfallLevels = mapped.slice(0, days);
        alert(`Loaded NASA rainfall data for ${crop} field!`);
      }
    } catch (e) {
      alert("NASA POWER data failed. Using mock rainfall.");
    }
  }

  function updateHud() {
    hud.week.setText(`Week ${week}`);
    hud.health.setText(`Crop Health: ${Math.round(cropHealth)}`);
    hud.sustain.setText(`Sustainability: ${Math.round(sustainability)}`);
    hud.profit.setText(`Profit: $${Math.round(profit)}`);
    hud.yield.setText(`Yield: ${Math.round(yieldScore)}`);
    hud.soil.setText(`Soil Moisture: ${Math.round(soilMoisture)}`);
    hud.nitro.setText(`Nitrogen: ${Math.round(nitrogen)}`);
    hud.pest.setText(`Pest Pressure: ${Math.round(pestPressure)}`);
    hud.tank.setText(`Water Tank: ${Math.round(waterTank)}/${TANK_CAP} L`);
    hud.price.setText(`Market Price: x${marketPrice.toFixed(2)}`);
  }

  // Utility helpers (trimmed)
  function clamp(min, max, v) {
    return Math.max(min, Math.min(max, v));
  }
  function currentRainLevel() {
    return rainfallLevels[(week - 1) % rainfallLevels.length];
  }
  function sayHint() {}
  function act() {}
  function installDrip() {}
  function resetGame() {}

  // Expose config
  return new Phaser.Game(config);
}
