# Containers for this project. The host needs Docker only, and no Bun.
#
#   make container-build              # builds the image
#   make container-start              # server at http://localhost:5173
#   make container-start PORT=3000    # another port, on both sides
#   make container-run SCRIPT=lint    # one script of package.json
#   make container-run                # lists the scripts of package.json
#   make container-shell              # a shell in the container
#   make container-clean              # removes container, volume and image
#
# This file manages the containers only. Each command of the application stays
# in package.json, which is the one authority for them.
#
# PORT is the port in the container and the port on the host. The two numbers
# are equal, because the reload socket of Vite reports the port of the
# container to the browser, and a different host port would break the reload.

PORT ?= 5173
IMAGE ?= mtg-meta-analyzer-dev
CONTAINER ?= mtg-meta-analyzer-dev
MODULES_VOLUME ?= mtg-meta-analyzer-dev-modules

# The volume for node_modules keeps the packages of the image. Without it, the
# mount of the working directory hides /app/node_modules, because the host has
# no node_modules directory.
MOUNTS = -v "$(CURDIR)":/app -v $(MODULES_VOLUME):/app/node_modules

.PHONY: container-build container-start container-run container-shell container-clean

# Docker answers from its cache while package.json and bun.lock do not change,
# so this step costs a second after the first build.
container-build:
	docker build -f Dockerfile.dev -t $(IMAGE) .

container-start: container-build
	docker run --rm -it \
		--name $(CONTAINER) \
		-e PORT=$(PORT) \
		-p $(PORT):$(PORT) \
		$(MOUNTS) \
		$(IMAGE)

container-run: container-build
	docker run --rm $(MOUNTS) $(IMAGE) bun run $(SCRIPT)

container-shell: container-build
	docker run --rm -it $(MOUNTS) $(IMAGE) sh

# A leading "-" lets a line fail without a stop of the target, because an
# object that is already absent is not an error here.
container-clean:
	-docker rm -f $(CONTAINER)
	-docker volume rm $(MODULES_VOLUME)
	-docker rmi $(IMAGE)
