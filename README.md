# csp-checker

A lightweight Docker image and scripts for automated Content Security Policy (CSP) validation using Puppeteer.

## Usage

1. Build the image:
   ```bash
   docker build -t your-registry/csp-checker:latest .
   ```

2. Run the crawler:

   ```bash
   docker run --rm \
     -v /etc/nginx/conf.d/http/servers/:/etc/nginx/conf.d/http/servers/:ro \
     your-registry/csp-checker:latest
   ```

Exit code `0` = no CSP blocks, `>0` = number of domains with issues.

## License

MIT