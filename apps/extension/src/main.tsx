import { createRoot } from "react-dom/client";
import { ProductApp } from "@video-analyzer/ui";
import "@video-analyzer/ui/styles.css";
import { extensionPlatform } from "./platform";
createRoot(document.getElementById("root")!).render(<ProductApp platform={extensionPlatform}/>);
