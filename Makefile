# Makefile
IMAGE ?= csp-checker:latest

.PHONY: install build run clean test

## Build with cache-bust and pull latest base
build:
	docker build --pull \
		--build-arg BUILD_TS=$(shell date +%s) \
		-t $(IMAGE) .

## Run the checker; pass domain args via ARGS="example.org api.example.org"
run:
	docker run --rm $(IMAGE) $(ARGS)

## Remove the built image (best-effort)
clean:
	- docker rmi $(IMAGE) 2>/dev/null || true

## Run Python unit tests
test:
	python3 -m unittest -v test.py