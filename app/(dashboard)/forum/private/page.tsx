import { PrismaClient } from '@prisma/client';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import Link from 'next/link';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const prisma = new PrismaClient();

async function getPrivateForums() {
  const forums = await prisma.forums.findMany({
    where: {
      type: 'Private'
    },
    include: {
      topics: {
        include: {
          messages: {
            include: {
              character: true
            },
            orderBy: {
              createdAt: 'desc'
            },
            take: 1
          },
          author: true
        },
        orderBy: {
          messages: {
            _count: 'desc'
          }
        }
      }
    }
  });
  return forums;
}

export default async function PrivateForums() {
  const forums = await getPrivateForums();
  const defaultForum = forums[0]?.name || 'all';

  return (
    <div className="flex flex-col flex-1 gap-4 p-4 md:gap-8 md:p-6">
      <div className="flex items-center">
        <h1 className="font-semibold text-lg md:text-2xl">Private Forums</h1>
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
                  <div className="space-y-4">
                    {forum.topics.map((topic) => {
                      const lastMessage = topic.messages[0];
                      return (
                        <div key={topic.id} className="flex justify-between items-center border-b pb-4">
                          <div>
                            <Link 
                              href={topic.link} 
                              className="text-lg font-medium hover:underline"
                            >
                              {topic.name}
                            </Link>
                            <div className="text-sm text-gray-500">
                              Started by {topic.author.name}
                            </div>
                          </div>
                          {lastMessage && (
                            <div className="text-sm text-gray-500 text-right">
                              Last reply by {lastMessage.character.name}
                              <br />
                              {new Date(lastMessage.createdAt).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}