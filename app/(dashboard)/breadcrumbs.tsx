"use client";

import { useRouter } from "next/navigation";

export function Breadcrumbs() {
  const router = useRouter();

  // Replace with actual logic to generate breadcrumb items
  const currentPath = router.asPath.split("/").filter((segment) => segment);

  return (
    <nav aria-label="breadcrumb">
      <ol className="flex space-x-2">
        {currentPath.map((segment, index) => (
          <li key={index} className="text-gray-500">
            {index > 0 && <span>/</span>}
            <span className="capitalize">{segment}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
