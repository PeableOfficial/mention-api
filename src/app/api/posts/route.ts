import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const type = searchParams.get("type") || undefined;
  const id = searchParams.get("id") || undefined;

  const cursorQuery = searchParams.get("cursor") || undefined;
  const take = Number(searchParams.get("limit")) || 20;

  const skip = cursorQuery ? 1 : 0;
  const cursor = cursorQuery ? { id: cursorQuery } : undefined;

  try {
    let followingUserIds: string[] = [];
    if (id) {
      followingUserIds = await prisma.user
        .findUnique({
          where: { id: id },
          select: { following: { select: { id: true } } },
        })
        .then(
          (user) =>
            user?.following.map((followingUser) => followingUser.id) || [],
        );
    }
    if (id) {
      followingUserIds.push(id);
    }

    const posts = await prisma.post.findMany({
      skip,
      take,
      cursor,

      where: {
        ...(type === "comments" && {
          in_reply_to_status_id: id,
        }),

        ...(type === "bookmarks" && {
          bookmarks: {
            some: {
              user_id: id,
            },
          },
        }),

        ...(type === "search" && {
          text: {
            contains: id,
            mode: "insensitive",
          },
        }),

        ...(type === "user_posts" && {
          author_id: id,
        }),

        ...(type === "user_replies" && {
          author_id: id,
          NOT: {
            in_reply_to_status_id: null,
            in_reply_to_username: null,
            in_reply_to_user_id: null,
          },
        }),

        ...(type === "user_media" && {
          author_id: id,
          media: {
            some: {},
          },
        }),

        ...(type === "user_likes" && {
          likes: {
            some: {
              user_id: id,
            },
          },
        }),

        ...(type === "default" && {
          author_id: {
            in: followingUserIds,
          },
        }),
      },

      include: {
        author: {
          include: {
            bookmarks: true,
          },
        },

        likes: true,
        media: true,
        reposts: true,

        quoted_post: {
          include: {
            author: true,
            media: true,
          },
        },

        quotes: true,
        comments: true,

        bookmarks: {
          include: {
            user: true,
          },
          orderBy: {
            created_at: "desc",
          },
        },

        _count: {
          select: {
            comments: true,
            likes: true,
            quotes: true,
            reposts: true,
          },
        },
      },

      orderBy: {
        created_at: "desc",
      },
    });

    const nextId = posts.length < take ? undefined : posts[posts.length - 1].id;

    return NextResponse.json({
      posts,
      nextId,
    });
  } catch (error) {
    return NextResponse.error();
  }
}

export async function POST(request: Request) {
  const { post } = (await request.json()) as {
    post: {
      text: string;
      author_id: string;
      in_reply_to_username?: string;
      in_reply_to_status_id?: string;
      quoted_post_id?: string;
    };
  };

  post.text = encodeURIComponent(post?.text);

  const postSchema = z
    .object({
      text: z.string(),
      author_id: z.string().cuid(),
      in_reply_to_username: z.string().optional(),
      in_reply_to_status_id: z.string().cuid().optional(),
      quoted_post_id: z.string().cuid().optional(),
    })
    .strict();

  const zod = postSchema.safeParse(post);

  if (!zod.success) {
    return NextResponse.json(
      {
        message: "Invalid request body",
        error: zod.error.formErrors,
      },
      { status: 400 },
    );
  }

  try {
    const created_post = await prisma.post.create({
      data: {
        ...post,
      },
    });

    if (post.quoted_post_id) {
      await prisma.post.update({
        where: {
          id: post.quoted_post_id,
        },

        data: {
          quote_count: {
            increment: 1,
          },
        },
      });
    }

    return NextResponse.json(created_post, { status: 200 });
  } catch (error: any) {
    return NextResponse.json(
      {
        message: "Something went wrong",
        error: error.message,
      },
      { status: error.errorCode || 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id") as string;

  const idSchema = z.string().cuid();
  const zod = idSchema.safeParse(id);

  if (!zod.success) {
    return NextResponse.json(
      {
        message: "Invalid request body",
        error: zod.error.formErrors,
      },
      { status: 400 },
    );
  }

  try {
    await prisma.post.delete({
      where: {
        id,
      },
    });
    return NextResponse.json({
      message: "Post deleted successfully",
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        message: "Something went wrong",
        error: error.message,
      },
      { status: error.errorCode || 500 },
    );
  }
}
