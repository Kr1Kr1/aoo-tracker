import prisma from '@/lib/prisma';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TopicList } from "../topic-list";

async function getHrpForums() {
  const forums = await prisma.forums.findMany({
    where: {
      type: 'HRP'
    },
    include: {
      topics: {
        include: {
          messages: {
            include: {
              character: { select: { id: true, name: true } }
            },
            orderBy: { id: 'asc' }
          },
          author: { select: { id: true, name: true } }
        },
        orderBy: {
          updatedAt: 'desc'
        }
      }
    }
  });
  return forums;
}

export default async function HrpForums() {
  const forums = await getHrpForums();
  const defaultForum = forums[0]?.name || 'all';

  return (
    <div className="flex flex-col flex-1 gap-4 p-4 md:gap-8 md:p-6">
      <div className="flex items-center">
        <h1 className="font-semibold text-lg md:text-2xl">HRP Forums</h1>
      </div>
      <Tabs defaultValue={defaultForum} className="flex-1">
        <div className="flex items-center">
          <TabsList>
            {forums.map(forum => (
              <TabsTrigger key={forum.id} value={forum.name}>
                {forum.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {forums.map(forum => (
          <TabsContent key={forum.id} value={forum.name} className="flex-1 pt-6">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>{forum.name}</CardTitle>
                  <CardDescription>
                    {forum.topics.length} topics
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <TopicList topics={forum.topics} />
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
