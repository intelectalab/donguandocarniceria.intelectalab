import type { Metadata } from "next";
import { Archivo, JetBrains_Mono, Source_Sans_3 } from "next/font/google";
import "./globals.css";
import { SCRIPT_TEMA } from "@/lib/temaMarca";

const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"] });
const sourceSans = Source_Sans_3({ variable: "--font-source-sans", subsets: ["latin"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "GestionCarnica · Comercial",
  description: "Pedidos, reparto, producción y comprobantes en un solo lugar",
};

// Aplica el tema guardado antes de pintar, para que no parpadee al cargar.
const THEME_SCRIPT = `try{var t=localStorage.getItem('aycha-tema');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${archivo.variable} ${sourceSans.variable} ${jetbrains.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {/* Colores de la marca guardados (solo #RRGGBB, validados en lib/temaMarca). */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
