#!/usr/bin/env python
"""Django's command-line utility (django-configurations aware)."""

import os
import sys


def main():
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "app.config.settings")
    os.environ.setdefault("DJANGO_CONFIGURATION", "Local")
    from configurations.management import execute_from_command_line

    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
