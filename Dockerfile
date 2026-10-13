# Hello-world starter app: proves the ECS deploy pipeline end-to-end.
# Replace this Dockerfile with your real application when ready.
#
# The ECS task definition injects a PORT environment variable set to the
# container_port the app was provisioned with; nginx's entrypoint substitutes
# it into default.conf.template at startup, so this image listens on the right
# port no matter what was chosen. Have your real app read $PORT too.
#
# Run locally:  docker build -t hello . && docker run -e PORT=8080 -p 8080:8080 hello
FROM nginx:stable-alpine

# Local-run default; ECS always overrides this with the provisioned port.
ENV PORT=80

COPY default.conf.template /etc/nginx/templates/default.conf.template
COPY index.html /usr/share/nginx/html/index.html
