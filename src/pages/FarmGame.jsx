// FarmGame.jsx
import React, { useEffect, useRef, useState } from "react";
import Phaser from "phaser";
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Title,
  Tooltip,
  Legend
} from "chart.js";
import { useNavigate } from "react-router-dom";

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Title, Tooltip, Legend);

export default function FarmGame() {
  const phaserContainer = useRef(null);
  const gameRef = useRef(null);
  const chartRef = useRef(null);
  const navigate = useNavigate();
  const [actionLog, setActionLog] = useState([]);
  const [showEndModal, setShowEndModal] = useState(false);
  const [endSummary, setEndSummary] = useState("");

  useEffect(() => {
    const data = JSON.parse(localStorage.getItem("weatherData"));
    const locationName = localStorage.getItem("selectedLocationName") || "Unknown";
    const cropType = localStorage.getItem("selectedCrop") || "maize";

    if (!data || !data.precip) {
      alert("No NASA data found. Please select a farm on the map first.");
      navigate("/");
      return;
    }

    // Rain pattern distinguishes "none" from "low"
    const rainPattern = data.precip.map((mm) => {
      if (mm === 0) return "none";
      if (mm < 3) return "low";
      if (mm < 10) return "medium";
      return "high";
    });

    class FarmScene extends Phaser.Scene {
      constructor() {
        super({ key: "FarmScene" });
      }

      init() {
        this.cropType = cropType;
        this.locationName = locationName;
        this.rainPattern = rainPattern;
        this.day = 1;
        this.money = 20;
        this.sustainability = 80;
        this.pests = 15;
        this.nitrogen = 45;
        this.cropHealth = 70;
        this.marketPrice = 1.0;
        this.soilMoisture = data.soil_moisture?.[0] || 55;
        this.precipSeries = [data.precip[0] || 0];
        this.rainDrops = [];
        this.actionsTakenToday = [];
      }

      create() {
        const WIDTH = this.sys.game.config.width;
        const HEIGHT = this.sys.game.config.height;

        // Background
        const g = this.add.graphics();
        g.fillStyle(0x87ceeb, 1);
        g.fillRect(0, 0, WIDTH, HEIGHT / 2);
        g.fillStyle(0x3e8e41, 1);
        g.fillRect(0, HEIGHT / 2, WIDTH, HEIGHT / 2);

        // Crop circle
        this.cropCircle = this.add.circle(WIDTH / 2, HEIGHT / 2 + 60, 40, 0x2ecc71);

        // HUD
        this.hud = this.add.text(20, 20, "", { font: "14px Courier", fill: "#111" });
        this.feedback = this.add.text(20, HEIGHT - 120, "", {
          font: "14px Arial",
          fill: "#0044aa",
          wordWrap: { width: WIDTH - 40 },
        });

        // Title
        this.add.text(20, HEIGHT - 160, `🌾 ${this.cropType.toUpperCase()} Farm`, {
          font: "18px Arial",
          fill: "black",
        });
        this.add.text(20, HEIGHT - 140, `📍 ${this.locationName}`, { font: "14px Arial", fill: "#333" });

        // Action buttons
        const actions = ["Irrigate", "Fertilize", "Scout", "Wait"];
        actions.forEach((a, i) => {
          const btn = this.add.text(20 + i * 150, HEIGHT - 80, `🟩 ${a}`, {
            font: "16px Arial",
            color: "black",
            backgroundColor: "#d1fae5",
            padding: { x: 6, y: 4 },
          });
          btn.setInteractive({ useHandCursor: true }).on("pointerdown", () => this.handleAction(a));
        });

        // Next Day button
        const nextBtn = this.add.text(20 + 4 * 150, HEIGHT - 80, "➡️ Next Day", {
          font: "16px Arial",
          backgroundColor: "#fbbf24",
          padding: { x: 6, y: 4 },
        });
        nextBtn.setInteractive({ useHandCursor: true }).on("pointerdown", () => this.nextDay());

        // Exit button
        const exitBtn = this.add.text(WIDTH - 140, 20, "⬅️ Exit", {
          font: "16px Arial",
          backgroundColor: "#fde68a",
          padding: { x: 8, y: 4 },
        });
        exitBtn.setInteractive({ useHandCursor: true }).on("pointerdown", () => {
          this.game.destroy(true);
          gameRef.current = null;
          navigate("/");
        });

        this.initChart();
        this.createRain();
        this.updateHud();
        this.updateCropVisual();
      }

      createRain() {
        this.rainDrops.forEach(drop => drop.destroy());
        this.rainDrops = [];
        const rainLevel = this.rainPattern[this.day - 1] || "medium";
        const dropCount =
          rainLevel === "none" ? 0 : rainLevel === "low" ? 10 : rainLevel === "medium" ? 30 : 60;
        const WIDTH = this.sys.game.config.width;
        for (let i = 0; i < dropCount; i++) {
          const x = Phaser.Math.Between(0, WIDTH);
          const y = Phaser.Math.Between(-50, 0);
          const drop = this.add.line(x, y, 0, 0, 0, 10, 0x3498db).setLineWidth(2);
          this.rainDrops.push(drop);
        }
      }

      updateRain() {
        const HEIGHT = this.sys.game.config.height;
        const WIDTH = this.sys.game.config.width;
        this.rainDrops.forEach(drop => {
          drop.y += 4;
          if (drop.y > HEIGHT) {
            drop.y = Phaser.Math.Between(-50, 0);
            drop.x = Phaser.Math.Between(0, WIDTH);
          }
        });
      }

      initChart() {
        const canvas = document.createElement("canvas");
        canvas.width = 400;
        canvas.height = 200;
        canvas.className = "bg-white border border-gray-300";
        document.getElementById("dashboard-charts").appendChild(canvas);
        chartRef.current = new Chart(canvas.getContext("2d"), {
          type: "line",
          data: {
            labels: [this.day],
            datasets: [
              { label: "Soil Moisture", data: [this.soilMoisture], borderColor: "#2ecc71", fill: false },
              { label: "Precipitation", data: [data.precip[0] || 0], borderColor: "#3498db", fill: false },
            ],
          },
          options: { responsive: false, animation: false, plugins: { legend: { position: "top" } } },
        });
      }

      updateChart() {
        if (!chartRef.current) return;
        chartRef.current.data.labels.push(this.day);
        chartRef.current.data.datasets[0].data.push(this.soilMoisture);
        chartRef.current.data.datasets[1].data.push(data.precip[this.day - 1] || 0);
        chartRef.current.update();
      }

      updateHud() {
        this.hud.setText(
          `Day: ${this.day}\n💧 Moisture: ${this.soilMoisture.toFixed(0)}\n🌿 Nitrogen: ${this.nitrogen.toFixed(
            0
          )}\n🐛 Pests: ${this.pests.toFixed(0)}\n💰 Money: ₦${this.money.toFixed(
            1
          )}\n🌍 Sustainability: ${this.sustainability.toFixed(0)}`
        );
      }

      updateCropVisual() {
        const radius = Phaser.Math.Linear(20, 60, this.cropHealth / 100);
        const color =
          this.cropHealth > 70 ? 0x2ecc71 : this.cropHealth > 40 ? 0xf1c40f : 0xe74c3c;
        this.cropCircle.setRadius(radius);
        this.cropCircle.setFillStyle(color);
      }

      handleAction(action) {
        if (this.day > this.rainPattern.length) return;

        const rain = this.rainPattern[this.day - 1] || "medium";
        let feedback = `🌧️ Rain: ${rain === "none" ? "No rain" : rain.toUpperCase()}`;

        // Update soil moisture based on rain
        if (rain === "none") this.soilMoisture -= 7;
        else if (rain === "low") this.soilMoisture -= 5;
        else if (rain === "medium") this.soilMoisture += 6;
        else this.soilMoisture += 12;

        // Each action
        switch (action) {
          case "Irrigate": {
            this.soilMoisture += 10;
            this.money -= 3;
            if (rain !== "low" && rain !== "none") this.sustainability -= 2;
            feedback += "\n🚿 You irrigated, soil moisture increased.";
            break;
          }
          case "Fertilize": {
            this.nitrogen += 12;
            this.money -= 2;
            if (rain === "high") this.sustainability -= 3;
            feedback += "\n🌱 You fertilized, nitrogen increased.";
            break;
          }
          case "Scout": {
            const pestReduction = Phaser.Math.Between(5, 15);
            this.pests = Phaser.Math.Clamp(this.pests - pestReduction, 0, 100);
            this.money -= 1;
            feedback += `\n🔍 You scouted and reduced pests by ${pestReduction}.`;
            break;
          }
          case "Wait": {
            feedback += "\n⏳ You waited.";
            break;
          }
        }

        this.actionsTakenToday.push(action);

        // Random pest growth for the day
        const pestGrowth = Phaser.Math.Between(0, 5) + (100 - this.cropHealth) / 20;
        this.pests = Phaser.Math.Clamp(this.pests + pestGrowth, 0, 100);

        // Clamp soil & nitrogen
        this.soilMoisture = Phaser.Math.Clamp(this.soilMoisture, 0, 100);
        this.nitrogen = Phaser.Math.Clamp(this.nitrogen, 0, 100);

        // Update crop health
        this.cropHealth = Phaser.Math.Clamp(
          (this.soilMoisture * 0.4 + this.nitrogen * 0.4 + (100 - this.pests) * 0.2) / 1.5,
          0,
          100
        );

        // Update money based on crop health
        if (this.cropHealth > 70) this.money += 4 * this.marketPrice;
        else if (this.cropHealth > 40) this.money += 2 * this.marketPrice;

        this.marketPrice = Phaser.Math.Clamp(this.marketPrice + Phaser.Math.FloatBetween(-0.05, 0.05), 0.8, 1.5);

        this.feedback.setText(feedback);
        this.updateHud();
        this.updateCropVisual();
        this.createRain();
      }

      nextDay() {
        if (this.day > this.rainPattern.length) return;

        const todayActions = this.actionsTakenToday.length ? [...this.actionsTakenToday] : ["No action"];
        const rainToday = this.rainPattern[this.day - 1] || "none";
        setActionLog((prev) => [
          ...prev,
          `Day ${this.day}: ${todayActions.join(", ")} (Rain: ${rainToday === "none" ? "No rain" : rainToday.toUpperCase()})`,
        ]);

        this.updateChart();
        this.actionsTakenToday = [];
        this.day += 1;

        if (this.day > this.rainPattern.length) {
          setEndSummary(
            `🌾 Season Complete!\n\nFinal Profit: ₦${this.money.toFixed(
              1
            )}\nSustainability: ${this.sustainability.toFixed(0)}\nCrop Health: ${this.cropHealth.toFixed(0)}`
          );
          setShowEndModal(true);
        } else {
          this.feedback.setText("");
        }
      }

      update() {
        this.updateRain();
      }
    }

    const config = {
      type: Phaser.AUTO,
      width: phaserContainer.current.clientWidth || 960,
      height: phaserContainer.current.clientHeight || 600,
      backgroundColor: "#bde0fe",
      parent: phaserContainer.current,
      scene: FarmScene,
    };

    gameRef.current = new Phaser.Game(config);

    return () => {
      if (gameRef.current) gameRef.current.destroy(true);
      if (chartRef.current) chartRef.current.destroy();
    };
  }, [navigate]);

  return (
    <div className="flex w-full h-screen">
      <div ref={phaserContainer} className="w-2/3 h-full relative" />
      <div className="w-1/3 h-full p-6 bg-gray-100 overflow-y-auto">
        <h2 className="text-center text-lg font-bold">📊 Farm Dashboard</h2>
        <div id="dashboard-charts" />
        <h3 className="mt-2 font-semibold">Action Log</h3>
        <div className="max-h-72 overflow-y-auto border border-gray-300 p-2 bg-white">
          {actionLog.map((a, i) => <div key={i}>{a}</div>)}
        </div>
      </div>

      {showEndModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
          <div className="bg-white rounded p-6 w-1/3 shadow-lg">
            <h2 className="text-xl font-bold mb-4">🌾 Season Complete!</h2>
            <pre className="whitespace-pre-wrap">{endSummary}</pre>
            <button
              className="mt-4 bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
              onClick={() => {
                setShowEndModal(false);
                if (gameRef.current) {
                  gameRef.current.destroy(true);
                  gameRef.current = null;
                }
                navigate("/");
              }}
            >
              ⬅️ Go to Map
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
