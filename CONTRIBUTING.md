# Contributing to Pixapie

Thanks for helping out! Bug reports and ideas are welcome as [issues](https://github.com/Alpaca-Media-Limited/pixapie/issues), and code changes as pull requests.

The easiest way to contribute is to **add an API to the catalogue**.

## Adding an API to the catalogue

The catalogue is a library of ready-made, documented requests. Each API is a single JSON file in the [`catalogue/`](catalogue/) folder.

### The easy way: from inside Pixapie

1. Save the requests you want to share.
2. Open **API CATALOGUE** and click **+ NEW TEMPLATE**.
3. Add your saved requests, then give the template a name, a description, and a short note for each request.
4. Click **SAVE TEMPLATE**, then **SUBMIT TO LIBRARY**.

GitHub opens with your file ready to go. Click **Propose new file** and then **Create pull request**. GitHub makes your own copy of the project automatically.

### By hand

Copy an existing file such as [`catalogue/cat-facts.json`](catalogue/cat-facts.json), rename it (lowercase-with-dashes, e.g. `my-api.json`), edit it, and open a pull request.

## What makes a good template

- **The API is public** and either free or has a free tier. Say in `auth` and `description` if a key or sign-up is needed, and where to get one.
- **No real secrets.** Never include real API keys, tokens or passwords. Use a variable like `{{apiKey}}` and explain it in `variables`.
- **Every request works** when sent as-is (after filling in the variables' example values).
- **Describe things in plain words.** Say what each request does and what each param is for. Mark each param, header and form field `"required": true` if the API needs it, or `false` if not. Optional extras can also be switched off with `"on": false` so they're there but not sent.
- **A handful of useful requests** is better than every endpoint. Link to the full docs in `docs`.

## Template format

```json
{
  "name": "Cat Facts",
  "category": "Fun",
  "description": "What the API does, and anything people should know.",
  "docs": "https://catfact.ninja/",
  "auth": "None",
  "variables": [
    { "key": "apiKey", "value": "example-value", "description": "What it's for and where to get one" }
  ],
  "requests": [
    {
      "name": "Random fact",
      "method": "GET",
      "url": "https://catfact.ninja/fact",
      "description": "What this request does.",
      "params": [
        { "key": "max_length", "value": "80", "on": false, "required": false, "description": "What this param does" }
      ],
      "headers": [
        { "key": "Accept", "value": "application/json", "on": true, "required": false }
      ]
    }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `name` | yes | The API's name |
| `description` | yes | Plain text. Blank lines start a new paragraph |
| `category` | no | e.g. Testing, Data, Developer, Weather, Fun. Defaults to Other |
| `docs` | no | Link to the API's own documentation |
| `auth` | no | e.g. "None", "API key in the X-Api-Key header" |
| `variables` | if used | Every `{{name}}` used in the requests must be listed, with an example `value` and a `description` |
| `requests` | yes | At least one |

Each request needs `name`, `method` (GET, POST, PUT, PATCH, DELETE, HEAD or OPTIONS) and `url`. It can also have:

- `description`
- `params`, `headers` and `form`, as lists of `{ "key", "value", "on", "required", "description" }` rows. Params switched on (`"on": true`) should also be in the `url`. `"required": true` shows the row as REQUIRED in the docs, and a required row can't be switched off.
- `bodyType`: `none`, `json`, `text`, `xml` or `form`. Use `body` for the text, or `form` for form fields.

### Check your template

With [Node.js](https://nodejs.org) installed, run this in the project folder:

```sh
npm run check-catalogue            # checks every file is valid
npm run check-catalogue -- --live  # also sends every request
```

The same check runs automatically on every pull request.

## Code changes

Pixapie has no dependencies and no build step. Edit `server.js` or the files in `public/`, run `npm start`, and refresh your browser.
