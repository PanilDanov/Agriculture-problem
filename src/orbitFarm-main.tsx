import ReactDOM from 'react-dom/client';
import '@fontsource/chakra-petch/latin-700.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import { OrbitFarmApp } from './orbitFarm-app';
import { preloadVisualAssets } from './domain/orbitFarm-assets';
import './orbitFarm-styles.css';

void preloadVisualAssets();
ReactDOM.createRoot(document.getElementById('root')!).render(<OrbitFarmApp />);
