// Componentes compartidos de pantalla. Importar desde aquí:
//   import { Button, DataTable, Field, Input, Modal, toast } from "@/components/ui";
// Muestra de todos en /componentes (solo en desarrollo).
export { Button, IconButton, buttonClass, type ButtonVariant } from "./Button";
export { Field, Input, Textarea, Select, Checkbox, Switch } from "./Field";
export { Modal } from "./Modal";
export { MapPicker, type LatLng, type MapReference } from "./MapPicker";
export { MapView, type MapPoint } from "./MapView";
export { DataTable, Pagination, type Column } from "./DataTable";
export { Badge, StatusBadge, Alert, PageHeader, Tabs, DetailList, type Tone } from "./display";
export { toast, confirmAction, UiHost } from "./feedback";
