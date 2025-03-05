import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export default async function handler(req, res) {
  const { id } = req.query;

  if (req.method === "GET") {
    const event = await prisma.events.findUnique({ where: { id: parseInt(id) } });
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }
    return res.status(200).json(event);
  }

  if (req.method === "PUT") {
    const { event, details, fromCol, withWhom, date, territory, source } = req.body;
    const updatedEvent = await prisma.events.update({
      where: { id: parseInt(id) },
      data: { event, details, fromCol, withWhom, date, territory, source },
    });
    return res.status(200).json(updatedEvent);
  }

  res.setHeader("Allow", ["GET", "PUT"]);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
