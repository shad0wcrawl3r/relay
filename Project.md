# Relay

Relay is my imagination of a workbench. Primarily built to track ongoing projects, write articles and publish them. All from one place. 

## Intended Behaviour
### Articles
A markdown editor, with title, tags and content. 
Uses the dev.to API to post to dev. mapped as follows:
```
title -> title
body_markdown -> content
tags -> tags
series -> series
```

### Project Management/Kanban
Just a kanban board that links back to app.plane.so. Fetches all active tickets, and publishes changes back into it. Think of this as: my very own frontend for plane.



## References
Publish article

This endpoint allows the client to create a new article.

"Articles" are all the posts that users create on DEV/Forem that typically show up in the feed. They can be a blog post, a discussion question, a help thread etc. but are referred to as articles within the code.
Body Parameter Tips:
    `title`: A compelling and descriptive title for the article.  
    `body_markdown`: The main text of the article in Markdown format. You can use standard Markdown as well as Forem-specific Liquid tags (e.g., {% embed ... %}). You can also include YAML front matter at the very beginning of the markdown to specify metadata such as tags, series, and cover image.  
    `published`: Set to true to immediately publish the article and make it visible in feeds. Set to false (default) to save it as a draft.  
    `tags`: A comma-separated list of tags (up to 4 tags). Tags help categorize your post and improve discoverability.  
    `series`: Group articles together by specifying a series name. If the series does not exist, it will be created.  
    `main_image`: Absolute URL of the cover image for the article.  
    `canonical_url`: If this post was originally published elsewhere, specify the canonical URL to maintain SEO integrity.  
    `description`: A short summary of the article used for previews and SEO meta description.  
```
Endpoint: /api/articles
Request: POST
{
  "article": {
    "title": "string",
    "body_markdown": "string",
    "published": false,
    "series": "string",
    "main_image": "string",
    "canonical_url": "string",
    "description": "string",
    "tags": "string",
    "organization_id": 0
  }
}
```
