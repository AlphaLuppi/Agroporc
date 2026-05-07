import { getAllPhotos } from "@/lib/db";
import AdminPhotosClient from "./AdminPhotosClient";

export default async function AdminPhotosPage() {
  const photos = await getAllPhotos();
  return <AdminPhotosClient initialPhotos={photos} />;
}
