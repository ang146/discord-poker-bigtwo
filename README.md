# Discord Poker Games

This is my personal project on creating a games playground in Discord using DiscordSDK and Discord activity. The project is purely created using Claude and few manual adjustments.

Current games collection include: Big Two (Chinese Poker)

## Environment Variables

To run this project, you will need to add the following environment variables to your .env file.

Do

```bash
  cp example.env .env
```

to get the template of .env file

Put your application ID and application secret to the following variables:

`VITE_DISCORD_CLIENT_ID`

`DISCORD_CLIENT_SECRET`

## Installation

Run the following command in the root of the project

```bash
  npm run install:all
```

Then run the following command to start both client and server

```bash
  npm run dev
```

## License

[MIT](https://choosealicense.com/licenses/mit/)
