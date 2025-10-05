import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import MapScreen from "./pages/MapScreen";
import FarmGame from "./pages/FarmGame";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<MapScreen />} />
        <Route path="/farm" element={<FarmGame />} />
      </Routes>
    </Router>
  );
}
